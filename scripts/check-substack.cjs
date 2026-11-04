const assert = require('node:assert/strict');
const { runInNewContext } = require('node:vm');
const { buildSync } = require('esbuild');

module.exports = (async () => {
	const requests = [];
	let respond;
	let language = 'fr';
	const timers = new Map();
	let timerId = 0;
	const secrets = new Map();
	class Plugin {
		constructor() {
			this.app = { secretStorage: {
				getSecret: key => secrets.get(key) ?? null,
				setSecret: (key, value) => secrets.set(key, value)
			}, workspace: { on: () => ({}) } };
			this.saved = null;
		}
		async loadData() { return this.saved; }
		async saveData(value) { this.saved = value; }
		addSettingTab(tab) { this.tab = tab; }
		register(callback) { this.cleanup = callback; }
		registerEvent() {}
	}
	class PluginSettingTab {
		constructor(app, plugin) { this.app = app; this.plugin = plugin; }
		update() {}
		async setControlValue(key, value) {
			this.plugin.settings[key] = value;
			await this.plugin.saveData(this.plugin.settings);
		}
	}
	const moduleForCheck = { exports: {} };
	runInNewContext(buildSync({
		stdin: { contents: "export { default } from './plugin/main'; export * from './plugin/substack'; export * from './plugin/i18n';", resolveDir: process.cwd(), loader: 'ts' },
		bundle: true, write: false, format: 'cjs', external: ['obsidian'], loader: { '.svg': 'text' }
	}).outputFiles[0].text, {
		module: moduleForCheck,
		exports: moduleForCheck.exports,
		URL,
		window: {
			setTimeout: (callback, delay) => {
				assert.equal(delay, 15000);
				const id = ++timerId;
				timers.set(id, callback);
				return id;
			},
			clearTimeout: id => timers.delete(id)
		},
		require: name => {
			assert.equal(name, 'obsidian');
			return { Plugin, PluginSettingTab, Modal: class {}, Notice: class {}, addIcon() {}, getLanguage: () => language, Platform: { isDesktopApp: false }, requestUrl: async request => {
				requests.push(request);
				return respond(request);
			} };
		}
	});
	const { normalizeSession, parseAccount, getAccount, createDraft, setLocale } = moduleForCheck.exports;
	setLocale('fr');
	const profile = { name: 'Compte de test', publicationUsers: [
		{ publication: { name: 'Première newsletter', subdomain: 'premiere' } },
		{ publication: { name: 'Deuxième newsletter', subdomain: 'deuxieme' } },
		{ publication: { name: 'Première newsletter', subdomain: 'premiere' } }
	], subscriptions: [{ publication: { subdomain: 'lecture-seulement' } }] };
	for (const [input, expected] of [
		[' token== ', 'substack.sid=token=='],
		['substack.sid=token', 'substack.sid=token'],
		['Cookie: substack.sid=token; connect.sid=other', 'substack.sid=token; connect.sid=other']
	]) assert.equal(normalizeSession(input), expected);
	for (const input of ['', 'substack.sid=', 'substack.sid=token\r\nOther: value', 'invalid session', 'other=value; bad']) {
		assert.throws(() => normalizeSession(input), /session Substack/);
	}
	for (let code = 0; code < 32; code++) assert.throws(() => normalizeSession(`token${String.fromCharCode(code)}value`), /session Substack/);
	assert.throws(() => normalizeSession(`token${String.fromCharCode(127)}value`), /session Substack/);
	const account = parseAccount(profile);
	assert.equal(account.name, profile.name);
	assert.equal(account.newsletters.map(item => item.subdomain).join(','), 'premiere,deuxieme');
	assert.equal(parseAccount({ publicationUsers: [] }).newsletters.length, 0);
	assert.equal(parseAccount({ publicationUsers: [{ publication: { subdomain: 'sans-nom' } }] }).newsletters[0].name, 'sans-nom');
	for (const invalid of [null, [], {}, { publicationUsers: {} }, { publicationUsers: [null] },
		{ publicationUsers: [{ publication: { subdomain: 'legitime.substack.com@autre.example' } }] }]) {
		assert.throws(() => parseAccount(invalid), /Substack/);
	}
	respond = () => ({ status: 200, json: profile });
	assert.equal((await getAccount('token')).newsletters.length, 2);
	const request = requests.at(-1);
	assert.equal(request.url, 'https://substack.com/api/v1/user/profile/self');
	assert.equal(request.method, 'GET');
	assert.equal(request.headers.Cookie, 'substack.sid=token');
	assert.equal(request.throw, false);
	for (const [status, message] of [[401, /refusée ou expirée/], [403, /refusée ou expirée/], [429, /trop de demandes/], [500, /indisponible/]]) {
		respond = () => ({ status, text: 'private server details' });
		const before = requests.length;
		await assert.rejects(getAccount('token'), message);
		assert.equal(requests.length, before + 1);
		if (status === 401 || status === 403) await assert.rejects(getAccount('token'), error => error.status === status);
	}
	respond = () => { throw new Error('private request details'); };
	await assert.rejects(getAccount('token'), /Impossible de joindre Substack/);
	respond = () => ({ status: 200, get json() { throw new Error('private HTML response'); } });
	await assert.rejects(getAccount('token'), /illisible/);
	respond = () => ({ status: 200, json: {} });
	await assert.rejects(getAccount('token'), /profil inattendu/);
	assert.equal(timers.size, 0, 'Completed requests must clear the deadline');
	respond = () => new Promise(() => {});
	const timedOut = getAccount('token');
	assert.equal(timers.size, 1);
	[...timers.values()][0]();
	await assert.rejects(timedOut, /Substack ne répond pas/);
	assert.equal(timers.size, 0, 'Timed out requests must clear the deadline');
	const newsletter = { name: 'Newsletter choisie', subdomain: 'choisie' };
	const post = { title: 'Un titre', subtitle: 'Un chapeau', body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Texte.' }] }] } };
	respond = () => ({ status: 200, json: { id: 123 } });
	assert.equal(await createDraft('token', newsletter, post), 'https://choisie.substack.com/publish/post/123');
	const draftRequest = requests.at(-1);
	assert.equal(draftRequest.url, 'https://choisie.substack.com/api/v1/drafts');
	assert.equal(draftRequest.method, 'POST');
	assert.equal(draftRequest.headers.Cookie, 'substack.sid=token');
	assert.equal(draftRequest.headers['Content-Type'], 'application/json');
	assert.deepEqual(JSON.parse(draftRequest.body), { draft_title: post.title, draft_subtitle: post.subtitle, draft_body: JSON.stringify(post.body), draft_bylines: [], audience: 'everyone', type: 'newsletter', section_chosen: false, write_comment_permissions: 'everyone' });
	const beforeInvalid = requests.length;
	await assert.rejects(createDraft('token', { subdomain: 'substack.com@attacker.invalid' }, post), /invalide/);
	assert.equal(requests.length, beforeInvalid);
	respond = () => ({ status: 200, json: {} });
	await assert.rejects(createDraft('token', newsletter, post), /Vérifiez vos brouillons/);
	for (const [status, message] of [[403, /droits du compte/], [500, /Vérifiez vos brouillons/]]) {
		respond = () => ({ status });
		await assert.rejects(createDraft('token', newsletter, post), message);
	}
	let postSent;
	const posting = new Promise(resolve => { postSent = resolve; });
	respond = () => { postSent(); return new Promise(() => {}); };
	const uncertainDraft = createDraft('token', newsletter, post);
	await posting;
	[...timers.values()][0]();
	await assert.rejects(uncertainDraft, /Vérifiez les brouillons/);
	assert.equal(timers.size, 0);
	respond = () => { throw new Error('private transport details'); };
	const beforePostFailure = requests.length;
	await assert.rejects(createDraft('token', newsletter, post), /Vérifiez les brouillons/);
	assert.equal(requests.length, beforePostFailure + 1, 'An uncertain POST must never be retried automatically');
	const dataUri = 'data:image/png;base64,AAECAwQF';
	const imageNode = { type: 'image2', attrs: { src: dataUri, alt: 'Image locale', fullscreen: false } };
	const illustratedPost = { ...post, body: { type: 'doc', content: [imageNode, imageNode] } };
	respond = request => ({ status: 200, json: request.url.endsWith('/image') ? { url: 'https://images.example.invalid/pixel.png' } : { id: 124 } });
	const beforeImages = requests.length;
	await createDraft('token', newsletter, illustratedPost);
	const imageRequests = requests.slice(beforeImages);
	assert.equal(imageRequests.length, 2, 'An image is uploaded once before creating the draft, even when embedded twice');
	assert.equal(imageRequests[0].url, 'https://choisie.substack.com/api/v1/image');
	assert.equal(imageRequests[0].method, 'POST');
	assert.equal(imageRequests[0].headers['Content-Type'], 'application/x-www-form-urlencoded');
	assert.equal(imageRequests[0].headers.Cookie, 'substack.sid=token');
	assert.equal(new URLSearchParams(imageRequests[0].body).get('image'), dataUri);
	const illustratedBody = JSON.parse(JSON.parse(imageRequests[1].body).draft_body);
	assert.equal(illustratedBody.content.length, 2);
	for (const image of illustratedBody.content) assert.equal(image.attrs.src, 'https://images.example.invalid/pixel.png');
	assert.equal(imageNode.attrs.src, dataUri, 'Preparing the upload must not change the source document');
	const beforeInvalidImage = requests.length;
	await assert.rejects(createDraft('token', newsletter, { ...post, body: { type: 'doc', content: [{ type: 'image2', attrs: { src: 'data:text/html;base64,AA==' } }] } }), /image.*invalide/);
	assert.equal(requests.length, beforeInvalidImage, 'Only encoded images may be uploaded');
	for (const response of [{ status: 500 }, { status: 200, json: { url: 'javascript:alert(1)' } }]) {
		respond = request => request.url.endsWith('/image') ? response : { status: 200, json: { id: 125 } };
		const beforeFailedImage = requests.length;
		await assert.rejects(createDraft('token', newsletter, illustratedPost), /image/);
		assert.equal(requests.length, beforeFailedImage + 1, 'A failed image upload must not create a partial draft or retry automatically');
	}

	const plugin = new moduleForCheck.exports.default();
	await plugin.onload();
	assert.equal(plugin.tab.icon, 'to-substack');
	assert.equal(plugin.account, null);
	await plugin.tab.setControlValue('sessionSecretId', 'session-importee');
	secrets.set('session-importee', 'fixture-session');
	respond = () => ({ status: 200, json: profile });
	await plugin.connect(false);
	assert.equal(plugin.account.newsletters.length, 2);
	assert.equal(plugin.tab.getSettingDefinitions()[1].items.length, 2);
	assert.equal(Object.keys(plugin.saved).join(','), 'sessionSecretId');
	assert.equal(JSON.stringify(plugin.saved).includes('fixture-session'), false);
	await plugin.disconnect();
	assert.equal(plugin.account, null);
	assert.equal(plugin.settings.sessionSecretId, '');
	assert.equal(plugin.saved.sessionSecretId, '');
	assert.equal(secrets.get('session-importee'), 'fixture-session', 'Imported shared secrets belong to the user');

	await plugin.tab.setControlValue('sessionSecretId', 'session-importee');
	let finish;
	respond = () => new Promise(resolve => { finish = resolve; });
	const connecting = plugin.connect(false);
	assert.equal(plugin.busy, true);
	const before = requests.length;
	await plugin.connect(false);
	assert.equal(requests.length, before, 'Concurrent clicks must not duplicate requests');
	plugin.cleanup();
	finish({ status: 200, json: profile });
	await connecting;
	assert.equal(plugin.account, null, 'An unloaded plugin must ignore a late profile response');
	assert.equal(plugin.busy, false);
	respond = () => ({ status: 401 });
	await plugin.connect(false);
	assert.equal(plugin.account, null);
	assert.match(plugin.error, /refusée ou expirée/);
	assert.equal(plugin.busy, false);
	assert.equal(secrets.get('session-importee'), 'fixture-session');
	for (const [selectedLanguage, heading] of [['en', 'Substack account'], ['fr-CA', 'Compte Substack'], ['de', 'Substack account']]) {
		language = selectedLanguage;
		const localizedPlugin = new moduleForCheck.exports.default();
		await localizedPlugin.onload();
		assert.equal(localizedPlugin.tab.getSettingDefinitions()[0].heading, heading);
		await localizedPlugin.tab.setControlValue('sessionSecretId', 'session-importee');
		await localizedPlugin.connect(false);
		assert.match(localizedPlugin.error, selectedLanguage === 'fr-CA' ? /refusée ou expirée/ : /Session rejected or expired/);
	}
	console.log('Substack: session validation, profile parsing, HTTP errors, native settings, secret references, cancelled requests and app-language selection pass.');
})();
