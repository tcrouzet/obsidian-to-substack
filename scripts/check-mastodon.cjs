const assert = require('node:assert/strict');
const { webcrypto, createHash } = require('node:crypto');
const { runInNewContext } = require('node:vm');
const { buildSync } = require('esbuild');
const { readFileSync } = require('node:fs');
const ts = require('typescript');

module.exports = (async () => {
	const requests = [];
	let respond;
	let expire = false;
	const mod = { exports: {} };
	runInNewContext(buildSync({ entryPoints: ['plugin/mastodon.ts'], bundle: true, write: false, format: 'cjs', external: ['obsidian'] }).outputFiles[0].text, {
		module: mod, exports: mod.exports, URL, TextEncoder, Request, FormData, Blob, Uint8Array, ArrayBuffer,
		window: { crypto: webcrypto, setTimeout: (callback, delay) => setTimeout(callback, expire || delay === 500 ? 0 : delay), clearTimeout },
		require: name => {
			assert.equal(name, 'obsidian');
			return {
				arrayBufferToBase64: value => Buffer.from(value).toString('base64'),
				base64ToArrayBuffer: value => Uint8Array.from(Buffer.from(value, 'base64')).buffer,
				requestUrl: async request => {
					assert.equal(new URL(request.url).origin, 'https://mastodon.example');
					assert.equal(request.headers?.Cookie, undefined);
					requests.push(request);
					return respond(request);
				}
			};
		}
	});
	const { normalizeMastodonServer, beginMastodonLogin, completeMastodonLogin, parseMastodonSession, publishMastodonNote, mastodonStatusText, revokeMastodonSession } = mod.exports;
	assert.equal(normalizeMastodonServer(' mastodon.example '), 'https://mastodon.example');
	for (const value of ['http://mastodon.example', 'https://user:password@mastodon.example', 'https://mastodon.example/@user', 'https://mastodon.example?token=private']) assert.throws(() => normalizeMastodonServer(value));
	respond = () => ({ status: 200, json: { client_id: 'fixture-client', client_secret: 'fixture-secret' } });
	const pending = await beginMastodonLogin('mastodon.example', 'obsidian://to-substack-mastodon?vault=Fixture');
	const authorization = new URL(pending.authorizationUrl);
	assert.equal(authorization.origin, 'https://mastodon.example');
	assert.equal(authorization.pathname, '/oauth/authorize');
	assert.equal(authorization.searchParams.get('state'), pending.state);
	assert.equal(authorization.searchParams.get('code_challenge_method'), 'S256');
	assert.equal(authorization.searchParams.get('code_challenge'), createHash('sha256').update(pending.verifier).digest('base64url'));
	assert.equal(JSON.parse(requests[0].body).scopes, 'read:accounts write:statuses write:media');
	const beforeInvalid = requests.length;
	await assert.rejects(completeMastodonLogin(pending, { state: 'wrong', code: 'fixture-code' }));
	await assert.rejects(completeMastodonLogin({ ...pending, createdAt: 0 }, { state: pending.state, code: 'fixture-code' }));
	assert.equal(requests.length, beforeInvalid, 'Invalid or expired callbacks must never exchange a token');
	respond = request => ({ status: 200, json: request.url.endsWith('/oauth/token') ? { access_token: 'fixture-access-token' } : { id: '1', acct: 'writer' } });
	const session = await completeMastodonLogin(pending, { state: pending.state, code: 'fixture-code' });
	assert.equal(session.server, 'https://mastodon.example');
	assert.equal(session.account, 'writer@mastodon.example');
	const tokenRequest = requests.find(request => request.url.endsWith('/oauth/token'));
	assert.equal(JSON.parse(tokenRequest.body).code_verifier, pending.verifier);
	assert.equal(requests.at(-1).headers.Authorization, 'Bearer fixture-access-token');
	assert.equal(parseMastodonSession(JSON.stringify(session)).account, session.account);
	assert.throws(() => parseMastodonSession(JSON.stringify({ ...session, server: 'http://mastodon.example' })));

	const link = 'https://substack.com/note/c-123';
	const short = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'A short note.' }] }] };
	assert.equal(mastodonStatusText(short, 100, 23), 'A short note.');
	assert.equal(mastodonStatusText(short, 100, 23, link), 'A short note.', 'Do not add a Substack footer when the complete text fits');
	const long = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '😀 A long note. '.repeat(100) }] }] };
	const shortened = mastodonStatusText(long, 100, 23);
	assert.ok(shortened.endsWith('...'));
	assert.equal(shortened.includes(link), false);
	assert.ok(Array.from(shortened).length <= 100);
	assert.equal(shortened.includes('\ufffd'), false);
	const mastodonLength = text => Array.from(text.replace(/https?:\/\/[^\s]+/g, 'u'.repeat(23))).length;
	const withFooter = mastodonStatusText(long, 100, 23, link);
	assert.ok(withFooter.endsWith('...\n\n'+link), 'A shortened post must end with the complete Substack Note URL on its own line');
	assert.ok(mastodonLength(withFooter) <= 100, 'Reserve room for the URL, separators and ellipsis before shortening');
	assert.equal(withFooter.includes('\ufffd'), false);
	const exactlyFits = { type: 'doc', content: [{ type: 'text', text: 'a'.repeat(100) }] };
	assert.equal(mastodonStatusText(exactlyFits, 100, 23, link), 'a'.repeat(100));
	const linked = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Read this', marks: [{ type: 'link', attrs: { href: 'https://example.org/article' } }] }] }] };
	assert.ok(mastodonStatusText(linked, 200, 23).includes('https://example.org/article'));
	const articleLink = 'https://example.org/article';
	const lateLink = { type: 'doc', content: [...long.content, ...linked.content] };
	assert.ok(mastodonStatusText(lateLink, 100, 23).endsWith('...\n\n' + articleLink), 'Keep a labeled link beyond the truncated text');
	const rawLinks = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Long note. '.repeat(100) + articleLink + '\nhttps://example.org/second' }] }] };
	const preserved = mastodonStatusText(rawLinks, 100, 23);
	assert.ok(preserved.endsWith('...\n\n' + articleLink + '\nhttps://example.org/second'), 'Keep every original link');
	const preservedWithFooter = mastodonStatusText(rawLinks, 100, 23, link);
	assert.ok(preservedWithFooter.endsWith(articleLink+'\nhttps://example.org/second\n'+link), 'Keep original links and place the Substack Note last');
	assert.ok(mastodonLength(preservedWithFooter) <= 100);
	const alreadyLinked = { type: 'doc', content: [{ type: 'text', text: 'Long note. '.repeat(100)+link+'.' }] };
	const deduplicated = mastodonStatusText(alreadyLinked, 100, 23, link);
	assert.equal(deduplicated.split(link).length-1, 1, 'Do not duplicate a Substack URL already present, including trailing punctuation');
	assert.ok(deduplicated.endsWith('\n'+link));
	assert.ok(mastodonLength(deduplicated) <= 100);
	assert.equal(mastodonStatusText({ type: 'doc', content: [{ type: 'text', text: articleLink }] }, 23, 23), articleLink, 'Count links using the server reservation');
	assert.throws(() => mastodonStatusText(rawLinks, 40, 23), /links/i, 'Fail instead of silently dropping links that cannot fit');
	const adjacent = { type: 'doc', content: [{ type: 'paragraph', content: [...linked.content[0].content, { type: 'text', text: 'Next sentence. '.repeat(50) }] }] };
	assert.ok(mastodonStatusText(adjacent, 100, 23).endsWith('...\n\n' + articleLink), 'Keep the exact hyperlink even without whitespace in the next text node');
	const hugeUrl = articleLink + '?query=' + 'a'.repeat(500);
	assert.equal(mastodonStatusText({ type: 'doc', content: [{ type: 'text', text: hugeUrl }] }, 23, 23), hugeUrl, 'Keep long URLs intact using the server character count');

	const configuration = { statuses: { max_characters: 100, max_media_attachments: 4, characters_reserved_per_url: 23 }, media_attachments: { image_size_limit: 1000, supported_mime_types: ['image/png'] } };
	let mediaChecks = 0;
	respond = async request => {
		if (request.url.endsWith('/api/v2/instance')) return { status: 200, json: { configuration } };
		if (request.url.endsWith('/api/v2/media')) {
			const form = await new Request(request.url, { method: 'POST', headers: { 'Content-Type': request.headers['Content-Type'] }, body: request.body }).formData();
			assert.equal(form.get('description'), 'Accessible image');
			assert.deepEqual(Buffer.from(await form.get('file').arrayBuffer()), Buffer.from([0, 1, 2]));
			return { status: 202, json: { id: '42', url: null } };
		}
		if (request.url.endsWith('/api/v1/media/42')) { mediaChecks++; return { status: 200, json: { id: '42', url: 'https://cdn.example/image.png' } }; }
		assert.equal(request.url, 'https://mastodon.example/api/v1/statuses');
		assert.equal(request.headers['Idempotency-Key'], 'to-substack-note-123');
		const payload = JSON.parse(request.body);
		assert.ok(payload.status.endsWith('...\n\n'+link));
		assert.ok(mastodonLength(payload.status) <= configuration.statuses.max_characters);
		assert.deepEqual(payload.media_ids, ['42']);
		return { status: 200, json: { id: '1234', url: 'https://mastodon.example/@writer/1234' } };
	};
	const image = { type: 'image2', attrs: { src: 'data:image/png;base64,AAEC', alt: 'Accessible image' } };
	const illustrated = { ...long, content: [image, ...long.content, image] };
	const beforePost = requests.length;
	assert.equal(await publishMastodonNote(session, illustrated, link), 'https://mastodon.example/@writer/1234');
	assert.equal(mediaChecks, 1);
	assert.equal(requests.slice(beforePost).filter(request => request.url.endsWith('/api/v2/media')).length, 1, 'Deduplicate media');
	assert.equal(requests.slice(beforePost).filter(request => request.url.endsWith('/api/v1/statuses')).length, 1);

	respond = request => request.url.endsWith('/api/v2/instance') ? { status: 200, json: { configuration } } : { status: 500 };
	const beforeFailure = requests.length;
	await assert.rejects(publishMastodonNote(session, short, link));
	assert.equal(requests.slice(beforeFailure).filter(request => request.method === 'POST').length, 1, 'Never retry an uncertain Mastodon post');
	const beforeTooMany = requests.length;
	await assert.rejects(publishMastodonNote(session, { type: 'doc', content: Array.from({ length: 5 }, (_, index) => ({ type: 'image2', attrs: { src: 'data:image/png;base64,' + Buffer.from([index]).toString('base64') } })) }, link));
	assert.equal(requests.slice(beforeTooMany).filter(request => request.method === 'POST').length, 0, 'Reject media limits before uploading');
	respond = request => request.url.endsWith('/api/v2/instance') ? { status: 200, json: { configuration } } : new Promise(() => {});
	const beforeTimeout = requests.length;
	expire = true;
	try { await assert.rejects(publishMastodonNote(session, short, link)); }
	finally { expire = false; }
	assert.equal(requests.slice(beforeTimeout).filter(request => request.method === 'POST').length, 1, 'A timeout must not retry a publication');
	respond = request => ({ status: 200, json: request.url.endsWith('/api/v2/instance') ? { configuration } : { id: '999', url: 'https://other.example/@someone/999' } });
	await assert.rejects(publishMastodonNote(session, short, link), /Mastodon/);
	respond = () => ({ status: 200 });
	await revokeMastodonSession(session);
	assert.equal(requests.at(-1).url, 'https://mastodon.example/oauth/revoke');
	assert.equal(JSON.parse(requests.at(-1).body).token, 'fixture-access-token');
	assert.throws(() => parseMastodonSession('invalid'), error => error.reconnect === true);
	const buttons = [];
	class Element {
		constructor() { this.children = []; this.hidden = false; this.isConnected = true; }
		createEl(tag, options = {}) { const element = new Element(); element.tag = tag; element.text = options.text; this.children.push(element); return element; }
		setText(value) { this.text = value; }
		setAttribute() {}
	}
	class Modal {
		constructor(app) { this.app = app; this.contentEl = new Element(); this.modalEl = new Element(); }
	}
	class Setting {
		constructor(container) { this.settingEl = container.createEl('div'); }
		addButton(callback) {
			const button = { setButtonText(text) { this.text = text; return this; }, setDisabled(value) { this.disabled = value; return this; }, onClick(callback) { this.callback = callback; return this; } };
			callback(button); buttons.push(button); return this;
		}
	}
	const postModule = { exports: {} };
	runInNewContext(ts.transpileModule(readFileSync('plugin/post.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2018 } }).outputText, {
		module: postModule, exports: postModule.exports, require: name => {
			if (name === 'obsidian') return { Modal, Setting };
			if (name === './mastodon') return mod.exports;
			if (name === './i18n') return { t: key => key };
			if (name === './images') return {};
			assert.equal(name, './substack');
			return { publishNote: () => { throw Error('Never republish on Substack during Mastodon recovery'); } };
		}
	});
	const { PostModal } = postModule.exports;
	for (const failure of ['missing', 'invalid', '401-instance', '403-instance', '401-status', '403-status']) {
		buttons.length = 0;
		let stored = failure === 'missing' ? null : session, pendingAuthorization = false, reconnected = false, signIns = 0;
		const plugin = { app: {}, settings: { mastodonSecretId: 'fixture-secret' }, mastodonAccount: failure === 'missing' ? '' : session.account, mastodonError: '', mastodonBusy: false,
			get hasMastodonLogin() { return pendingAuthorization; },
			getMastodonSession: () => failure === 'invalid' && !reconnected ? parseMastodonSession('invalid') : stored,
			connectMastodon: async () => { signIns++; pendingAuthorization = true; plugin.mastodonError = ''; }
		};
		respond = request => {
			const isInstance = request.url.endsWith('/api/v2/instance');
			if (!reconnected && failure.endsWith(isInstance ? '-instance' : '-status')) return { status: Number(failure.slice(0,3)) };
			return { status: 200, json: isInstance ? { configuration } : { id: '1234', url: 'https://mastodon.example/@writer/1234' } };
		};
		const modal = new PostModal(plugin, {});
		await modal.mirrorNote(short, link);
		const row = modal.contentEl.children.find(element => element.tag === 'div');
		assert.equal(row.hidden, false, 'Offer reconnection for '+failure);
		assert.equal(plugin.mastodonAccount, '');
		const reconnect = buttons.find(button => button.text === 'reconnectMastodon');
		const resume = buttons.find(button => button.text === 'publishMastodon');
		await reconnect.callback();
		assert.equal(signIns, 1);
		const whileAuthorizing = requests.length;
		await resume.callback();
		assert.equal(requests.length, whileAuthorizing, 'Wait for browser authorization before trying to send');
		stored = session; pendingAuthorization = false; reconnected = true; plugin.mastodonAccount = session.account;
		const beforeResume = requests.length;
		await Promise.all([resume.callback(), resume.callback()]);
		await resume.callback();
		assert.equal(requests.slice(beforeResume).filter(request => request.url.endsWith('/api/v1/statuses')).length, 1, 'Resume the Mastodon copy once, never the Substack publication');
		assert.equal(row.hidden, true);
		assert.ok(modal.contentEl.children.some(element => element.tag === 'a' && element.text === 'openMastodonPost'));
	}
	buttons.length = 0;
	const uncertainPlugin = { app: {}, settings: { mastodonSecretId: 'fixture-secret' }, mastodonAccount: session.account, getMastodonSession: () => session,
		connectMastodon: () => { throw Error('No reconnection for an uncertain post'); } };
	respond = request => ({ status: request.url.endsWith('/api/v2/instance') ? 200 : 500, json: { configuration } });
	const uncertainModal = new PostModal(uncertainPlugin, {}), beforeUncertain = requests.length;
	await uncertainModal.mirrorNote(short, link);
	assert.equal(uncertainModal.contentEl.children.find(element => element.tag === 'div').hidden, true, 'An uncertain post must not offer a blind retry');
	for (const button of buttons) await button.callback();
	assert.equal(requests.slice(beforeUncertain).filter(request => request.url.endsWith('/api/v1/statuses')).length, 1);
	buttons.length = 0;
	const disconnected = new PostModal({ ...uncertainPlugin, settings: { mastodonSecretId: '' }, mastodonAccount: '' }, {});
	const beforeDisconnected = requests.length;
	await disconnected.mirrorNote(short, link);
	assert.equal(requests.length, beforeDisconnected, 'Respect an intentional disconnection');
	assert.equal(buttons.length, 0);
	console.log('Mastodon: OAuth state and PKCE, origin binding, truncation preserving original links, media, limits and no duplicate posts pass.');
	console.log('Mastodon recovery: missing/invalid secrets, HTTP 401/403, browser authorization, single Mastodon-only resume and uncertain-publication protection pass.');
})();
