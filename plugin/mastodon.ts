import { arrayBufferToBase64, base64ToArrayBuffer, requestUrl, RequestUrlParam, RequestUrlResponse } from 'obsidian';
import { t } from './i18n';
import type { PostNode } from './substack';

const SCOPES = 'read:accounts write:statuses write:media';

export interface MastodonSession {
	server: string;
	accessToken: string;
	clientId: string;
	clientSecret: string;
	account: string;
}

export interface MastodonLogin {
	server: string;
	clientId: string;
	clientSecret: string;
	redirectUri: string;
	state: string;
	verifier: string;
	createdAt: number;
	authorizationUrl: string;
}

export class MastodonError extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isSecret(value: unknown): value is string {
	return typeof value === 'string' && !!value && Array.from(value).every(character => character.charCodeAt(0) > 32 && character.charCodeAt(0) < 127);
}

export function normalizeMastodonServer(value: string): string {
	try {
		const url = new URL(value.includes('://') ? value.trim() : `https://${value.trim()}`);
		if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error();
		return url.origin;
	} catch { throw new MastodonError(t('mastodonInvalidServer')); }
}

async function request(server: string, path: string, options: Omit<RequestUrlParam, 'url'> = {}, token?: string, timeoutMs = 15000): Promise<RequestUrlResponse> {
	const origin = normalizeMastodonServer(server);
	if (token !== undefined && !isSecret(token)) throw new MastodonError(t('mastodonSessionExpired'));
	let timeout: number | undefined;
	const uncertain = path === '/api/v1/statuses' && options.method === 'POST';
	try {
		const response = await Promise.race([requestUrl({
			...options, url: origin + path, throw: false,
			headers: { 'Content-Type': 'application/json', ...options.headers, ...(token ? { Authorization: `Bearer ${token}` } : {}) }
		}), new Promise<never>((_resolve, reject) => {
			timeout = window.setTimeout(() => reject(new MastodonError(t(uncertain ? 'mastodonPublicationUncertain' : 'mastodonConnectionFailed'))), timeoutMs);
		})]);
		if (response.status === 401 || response.status === 403) throw new MastodonError(t('mastodonSessionExpired'));
		if (response.status < 200 || response.status >= 300) throw new MastodonError(t(uncertain ? 'mastodonPublicationUncertain' : 'mastodonConnectionFailed'));
		return response;
	} catch (error) {
		if (error instanceof MastodonError) throw error;
		throw new MastodonError(t(uncertain ? 'mastodonPublicationUncertain' : 'mastodonConnectionFailed'));
	} finally { if (timeout !== undefined) window.clearTimeout(timeout); }
}

function json(response: RequestUrlResponse): unknown {
	try { const value: unknown = response.json; return value; }
	catch { throw new MastodonError(t('mastodonConnectionFailed')); }
}

function randomSecret(): string {
	return Array.from(window.crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function beginMastodonLogin(value: string, redirectUri: string): Promise<MastodonLogin> {
	const server = normalizeMastodonServer(value);
	const application = json(await request(server, '/api/v1/apps', { method: 'POST', body: JSON.stringify({ client_name: 'To Substack', redirect_uris: redirectUri, scopes: SCOPES, website: 'https://github.com/tcrouzet/obsidian-to-substack' }) }));
	if (!isRecord(application) || !isSecret(application.client_id) || !isSecret(application.client_secret)) throw new MastodonError(t('mastodonConnectionFailed'));
	const state = randomSecret();
	const verifier = randomSecret();
	const digest = await window.crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
	const challenge = arrayBufferToBase64(digest).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
	const url = new URL('/oauth/authorize', server);
	for (const [key, entry] of Object.entries({ client_id: application.client_id, redirect_uri: redirectUri, response_type: 'code', scope: SCOPES, state, code_challenge: challenge, code_challenge_method: 'S256' })) url.searchParams.set(key, entry);
	return { server, clientId: application.client_id, clientSecret: application.client_secret, redirectUri, state, verifier, createdAt: Date.now(), authorizationUrl: url.href };
}

export async function completeMastodonLogin(login: MastodonLogin, params: Record<string, string>): Promise<MastodonSession> {
	if (params.state !== login.state || Date.now() - login.createdAt > 10 * 60 * 1000 || params.error || !isSecret(params.code)) throw new MastodonError(t('mastodonAuthorizationFailed'));
	const token = json(await request(login.server, '/oauth/token', { method: 'POST', body: JSON.stringify({ grant_type: 'authorization_code', client_id: login.clientId, client_secret: login.clientSecret, redirect_uri: login.redirectUri, code: params.code, code_verifier: login.verifier }) }));
	if (!isRecord(token) || !isSecret(token.access_token)) throw new MastodonError(t('mastodonAuthorizationFailed'));
	const session = { server: login.server, accessToken: token.access_token, clientId: login.clientId, clientSecret: login.clientSecret, account: '' };
	try {
		const account = json(await request(login.server, '/api/v1/accounts/verify_credentials', {}, token.access_token));
		if (!isRecord(account) || typeof account.id !== 'string' || typeof account.acct !== 'string' || !account.acct.trim()) throw new MastodonError(t('mastodonAuthorizationFailed'));
		session.account = account.acct.includes('@') ? account.acct : `${account.acct}@${new URL(login.server).host}`;
		return session;
	} catch (error) {
		await revokeMastodonSession(session).catch(() => {});
		throw error;
	}
}

export function parseMastodonSession(value: string): MastodonSession {
	try {
		const session: unknown = JSON.parse(value);
		if (!isRecord(session) || typeof session.server !== 'string' || !isSecret(session.accessToken) || !isSecret(session.clientId) || !isSecret(session.clientSecret) || typeof session.account !== 'string' || !session.account) throw new Error();
		return { server: normalizeMastodonServer(session.server), accessToken: session.accessToken, clientId: session.clientId, clientSecret: session.clientSecret, account: session.account };
	} catch { throw new MastodonError(t('mastodonSessionExpired')); }
}

export async function revokeMastodonSession(session: MastodonSession): Promise<void> {
	await request(session.server, '/oauth/revoke', { method: 'POST', body: JSON.stringify({ client_id: session.clientId, client_secret: session.clientSecret, token: session.accessToken }) });
}

export function mastodonStatusText(body: PostNode, maxCharacters: number, reservedPerUrl: number): string {
	const plain = (node: PostNode): string => {
		if (node.type === 'image2') return '';
		if (node.type === 'hardBreak') return '\n';
		if (node.text !== undefined) {
			const href = node.marks?.find(mark => mark.type === 'link')?.attrs?.href;
			return href && /^https?:\/\//.test(href) ? `${href === node.text ? '' : node.text + ' '}${href} ` : node.text;
		}
		const separator = ['doc', 'blockquote', 'bulletList', 'orderedList', 'listItem'].includes(node.type) ? '\n\n' : '';
		return (node.content || []).map(plain).filter(text => text !== '').join(separator);
	};
	const text = plain(body).trim();
	const tokens = text.match(/(?:https?:\/\/|www\.)\S+|[\s\S]/gu) || [];
	const isUrl = (token: string): boolean => /^(?:https?:\/\/|www\.)/.test(token);
	const cost = (token: string): number => isUrl(token) ? reservedPerUrl + (token.match(/[.,;:!?)\]}>"']+$/)?.[0].length || 0) : 1;
	if (tokens.reduce((sum, token) => sum + cost(token), 0) <= maxCharacters) return text;
	const links = [...new Set(tokens.filter(isUrl))];
	const suffix = links.length ? `\n\n${links.join('\n')}` : '';
	const budget = maxCharacters - links.reduce((sum, url) => sum + cost(url), 0) - (links.length ? links.length + 1 : 0) - 3;
	if (budget < 0) throw new MastodonError(t('mastodonTooManyLinks'));
	let shortened = '';
	let used = 0;
	for (const token of tokens) {
		if (isUrl(token)) continue;
		if (used + cost(token) > budget) break;
		shortened += token;
		used += cost(token);
	}
	return `${shortened.replace(/\s+$/, '')}...${suffix}`;
}

export async function publishMastodonNote(session: MastodonSession, body: PostNode, sourceUrl: string): Promise<string> {
	if (!/^https:\/\/substack\.com\/note\/c-[1-9][0-9]*$/.test(sourceUrl)) throw new MastodonError(t('mastodonPublicationUncertain'));
	const instance = json(await request(session.server, '/api/v2/instance', {}, session.accessToken));
	const configuration = isRecord(instance) && isRecord(instance.configuration) ? instance.configuration : null;
	const statuses = configuration && isRecord(configuration.statuses) ? configuration.statuses : null;
	const media = configuration && isRecord(configuration.media_attachments) ? configuration.media_attachments : null;
	if (!statuses || !media || typeof statuses.max_characters !== 'number' || !Number.isSafeInteger(statuses.max_characters) || statuses.max_characters <= 0 || typeof statuses.max_media_attachments !== 'number' || !Number.isSafeInteger(statuses.max_media_attachments) || statuses.max_media_attachments < 0 || typeof statuses.characters_reserved_per_url !== 'number' || !Number.isSafeInteger(statuses.characters_reserved_per_url) || statuses.characters_reserved_per_url < 0 || typeof media.image_size_limit !== 'number' || !Number.isSafeInteger(media.image_size_limit) || media.image_size_limit <= 0 || !Array.isArray(media.supported_mime_types) || !media.supported_mime_types.every(mime => typeof mime === 'string')) throw new MastodonError(t('mastodonInstanceUnsupported'));
	const status = mastodonStatusText(body, statuses.max_characters, statuses.characters_reserved_per_url);
	const images = new Map<string, string>();
	const collect = (node: PostNode): void => {
		if (node.type === 'image2' && typeof node.attrs?.src === 'string' && !images.has(node.attrs.src)) images.set(node.attrs.src, typeof node.attrs.alt === 'string' ? node.attrs.alt : '');
		for (const child of node.content || []) collect(child);
	};
	collect(body);
	if (images.size > statuses.max_media_attachments) throw new MastodonError(t('mastodonTooManyImages', { limit: String(statuses.max_media_attachments) }));
	const supportedMimeTypes = media.supported_mime_types;
	const imageSizeLimit = media.image_size_limit;
	const prepared = [...images].map(([src, alt]) => {
		const match = src.match(/^data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/]+={0,2})$/i);
		const mime = match?.[1].toLowerCase().replace('image/jpg', 'image/jpeg');
		if (!match || !mime || !supportedMimeTypes.includes(mime)) throw new MastodonError(t('mastodonImageUnsupported'));
		const bytes = base64ToArrayBuffer(match[2]);
		if (bytes.byteLength > imageSizeLimit) throw new MastodonError(t('mastodonImageTooLarge'));
		return { bytes, mime, alt };
	});
	const mediaIds: string[] = [];
	for (const image of prepared) {
		const form = new FormData();
		form.append('file', new Blob([image.bytes], { type: image.mime }), `image.${image.mime.split('/')[1].split('+')[0]}`);
		form.append('description', Array.from(image.alt).slice(0, typeof media.description_limit === 'number' ? media.description_limit : 1500).join(''));
		const encoded = new Request(`${session.server}/api/v2/media`, { method: 'POST', body: form });
		let attachment = json(await request(session.server, '/api/v2/media', { method: 'POST', headers: { 'Content-Type': encoded.headers.get('Content-Type') || '' }, body: await encoded.arrayBuffer() }, session.accessToken, 30000));
		if (!isRecord(attachment) || typeof attachment.id !== 'string' || !/^[0-9]+$/.test(attachment.id)) throw new MastodonError(t('mastodonImageFailed'));
		const id = attachment.id;
		const deadline = Date.now() + 60000;
		while (isRecord(attachment) && !attachment.url && Date.now() < deadline) {
			await new Promise<void>(resolve => window.setTimeout(resolve, 500));
			attachment = json(await request(session.server, `/api/v1/media/${id}`, {}, session.accessToken, Math.max(1, Math.min(15000, deadline - Date.now()))));
		}
		if (!isRecord(attachment) || attachment.id !== id || typeof attachment.url !== 'string' || !attachment.url) throw new MastodonError(t('mastodonImageFailed'));
		mediaIds.push(id);
	}
	try {
		const result = json(await request(session.server, '/api/v1/statuses', { method: 'POST', headers: { 'Idempotency-Key': `to-substack-note-${sourceUrl.slice(sourceUrl.lastIndexOf('-') + 1)}` }, body: JSON.stringify({ status, media_ids: mediaIds }) }, session.accessToken));
		if (!isRecord(result) || typeof result.id !== 'string' || !/^[0-9]+$/.test(result.id) || typeof result.url !== 'string') throw new Error();
		const url = new URL(result.url);
		if (url.origin !== normalizeMastodonServer(session.server) || url.username || url.password) throw new Error();
		return url.href;
	} catch (error) {
		if (error instanceof MastodonError) throw error;
		throw new MastodonError(t('mastodonPublicationUncertain'));
	}
}
