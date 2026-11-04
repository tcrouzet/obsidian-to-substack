import { t } from './i18n';
import { requestUrl, RequestUrlParam } from 'obsidian';

export interface PostNode {
	type: string;
	text?: string;
	attrs?: Record<string, string | number | boolean>;
	marks?: { type: string; attrs?: Record<string, string> }[];
	content?: PostNode[];
}

export interface PostContent {
	title: string;
	subtitle: string;
	body: PostNode;
}

export interface Newsletter {
	name: string;
	subdomain: string;
}

export interface SubstackAccount {
	name: string;
	newsletters: Newsletter[];
}

export class SubstackError extends Error {
	constructor(message: string, readonly status?: number) {
		super(message);
	}
}

export function normalizeSession(value: string): string {
	const session = value.trim().replace(/^cookie:\s*/i, '');
	if (!session || Array.from(session).some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) {
		throw new SubstackError(t('emptySession'));
	}
	if (session.split(';').some(part => part.trim().startsWith('substack.sid='))) {
		if (!session.split(';').every(part => /^[^\s=;]+=[^\s;]+$/.test(part.trim()))) {
			throw new SubstackError(t('invalidSession'));
		}
		return session;
	}
	if (/[\s;]/.test(session)) throw new SubstackError(t('invalidSession'));
	return `substack.sid=${session}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseAccount(value: unknown): SubstackAccount {
	if (!isRecord(value) || !Array.isArray(value.publicationUsers)) {
		throw new SubstackError(t('unexpectedProfile'));
	}
	const newsletters = new Map<string, Newsletter>();
	for (const membership of value.publicationUsers) {
		const publication: unknown = isRecord(membership) ? membership.publication : undefined;
		if (!isRecord(publication) || typeof publication.subdomain !== 'string' ||
			!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(publication.subdomain)) {
			throw new SubstackError(t('invalidNewsletterResponse'));
		}
		newsletters.set(publication.subdomain, {
			name: typeof publication.name === 'string' && publication.name.trim() ? publication.name : publication.subdomain,
			subdomain: publication.subdomain
		});
	}
	return {
		name: typeof value.name === 'string' && value.name.trim() ? value.name : t('substackAccount'),
		newsletters: [...newsletters.values()]
	};
}

async function request(session: string, options: RequestUrlParam): Promise<unknown> {
	const cookie = normalizeSession(session);
	let response;
	let timeout: number | undefined;
	try {
		response = await Promise.race([requestUrl({
			...options,
			headers: { 'Content-Type': 'application/json', ...options.headers, Cookie: cookie },
			throw: false
		}), new Promise<never>((_resolve, reject) => {
			timeout = window.setTimeout(() => reject(new SubstackError(options.method === 'POST' ? t('draftCreationUncertain') : t('substackTimeout'))), 15000);
		})]);
	} catch (error) {
		if (error instanceof SubstackError) throw error;
		if (options.method === 'POST') throw new SubstackError(t('draftCreationUncertain'));
		throw new SubstackError(t('substackConnectionFailed'));
	} finally {
		if (timeout !== undefined) window.clearTimeout(timeout);
	}
	if (response.status === 401 || response.status === 403) {
		if (options.method === 'POST' && response.status === 403) throw new SubstackError(t('draftPermissionDenied'), response.status);
		throw new SubstackError(t('sessionExpired'), response.status);
	}
	if (response.status === 429) {
		throw new SubstackError(t('tooManyRequests'));
	}
	if (response.status < 200 || response.status >= 300) {
		if (options.method === 'POST') throw new SubstackError(t('draftCreationUnconfirmed'));
		throw new SubstackError(t('substackUnavailable'));
	}
	try {
		const result: unknown = response.json;
		return result;
	} catch {
		if (options.method === 'POST') throw new SubstackError(t('draftResponseUnreadable'));
		throw new SubstackError(t('responseUnreadable'));
	}
}

export async function getAccount(session: string): Promise<SubstackAccount> {
	return parseAccount(await request(session, { url: 'https://substack.com/api/v1/user/profile/self', method: 'GET' }));
}

export async function createDraft(session: string, newsletter: Newsletter, post: PostContent): Promise<string> {
	if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(newsletter.subdomain)) throw new SubstackError(t('invalidNewsletter'));
	const baseUrl = `https://${newsletter.subdomain}.substack.com/api/v1`;
	const images = new Map<string, string>();
	const upload = async (node: PostNode): Promise<PostNode> => {
		let result = node;
		const src = node.type === 'image2' ? node.attrs?.src : undefined;
		if (typeof src === 'string' && src.startsWith('data:')) {
			if (!/^data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/]+={0,2}$/i.test(src)) throw new SubstackError(t('invalidEncodedImage'));
			let url = images.get(src);
			if (!url) {
				try {
					const response = await request(session, { url: `${baseUrl}/image`, method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: `image=${encodeURIComponent(src)}` });
					if (!isRecord(response) || typeof response.url !== 'string') throw new Error();
					const destination = new URL(response.url);
					if (destination.protocol !== 'https:' || destination.username || destination.password) throw new Error();
					url = destination.href;
					images.set(src, url);
				} catch {
					throw new SubstackError(t('imageUploadFailed'));
				}
			}
			result = { ...node, attrs: { ...node.attrs, src: url } };
		}
		if (node.content) {
			const content: PostNode[] = [];
			for (const child of node.content) content.push(await upload(child));
			result = { ...result, content };
		}
		return result;
	};
	const body = await upload(post.body);
	const result = await request(session, {
		url: `${baseUrl}/drafts`,
		method: 'POST',
		body: JSON.stringify({
			draft_title: post.title,
			draft_subtitle: post.subtitle,
			draft_body: JSON.stringify(body),
			draft_bylines: [], audience: 'everyone', type: 'newsletter', section_chosen: false, write_comment_permissions: 'everyone'
		})
	});
	if (!isRecord(result) || !['string', 'number'].includes(typeof result.id) || !/^[a-zA-Z0-9_-]+$/.test(String(result.id))) {
		throw new SubstackError(t('createdDraftUnconfirmed'));
	}
	return `https://${newsletter.subdomain}.substack.com/publish/post/${String(result.id)}`;
}
