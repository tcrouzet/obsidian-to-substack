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
				assert.equal(delay, requests.at(-1)?.url.includes('/translations/') ? 120000 : 15000);
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
	const { normalizeSession, parseAccount, getAccount, createDraft, activateDraftLanguages, setLocale } = moduleForCheck.exports;
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

	const progress = [];
	respond = () => ({ status: 200, json: { additional_post_languages_enabled: false } });
	const beforeDisabled = requests.length;
	assert.equal(await activateDraftLanguages('token', newsletter, '123', language => progress.push(language)), false);
	assert.deepEqual(requests.slice(beforeDisabled).map(request => request.method), ['GET']);
	let editions = [{ language: 'en', draft_body: JSON.stringify(post.body) }];
	let publicationLanguage = 'fr';
	let sourceLanguage = 'fr';
	let persistEdition = true;
	let translationStatus = 200;
	const translated = request => {
		if (request.url.endsWith('/publication_settings')) return { status: 200, json: { additional_post_languages_enabled: true, auto_translate_enabled: true } };
		if (request.url.endsWith('/publication')) return { status: 200, json: { language: publicationLanguage } };
		if (request.url.endsWith('/detect-language')) return { status: 200, json: { language: sourceLanguage } };
		if (request.method === 'GET' && request.url.endsWith('/drafts/123')) return { status: 200, json: { id: 123, language: null, post_translations: editions.slice() } };
		assert.equal(request.method, 'POST');
		assert.match(request.url, /\/drafts\/123\/translations\/(en|es|de|it|pt|fr)$/);
		assert.deepEqual(JSON.parse(request.body), { sourceLanguage });
		const edition = { language: request.url.split('/').at(-1), draft_body: JSON.stringify(post.body) };
		if (persistEdition && translationStatus === 200) editions.push(edition);
		return { status: translationStatus, json: edition };
	};
	respond = translated;
	const beforeLanguages = requests.length;
	assert.equal(await activateDraftLanguages('token', newsletter, '123', language => progress.push(language)), true);
	assert.deepEqual(progress, ['es', 'de', 'it', 'pt']);
	assert.deepEqual(requests.slice(beforeLanguages).filter(request => request.method === 'POST').map(request => request.url.split('/').at(-1)), progress);
	assert.equal(requests.at(-1).method, 'GET', 'Language editions must be read back before reporting success');
	assert.equal(requests.at(-1).url, 'https://choisie.substack.com/api/v1/drafts/123');
	editions = [];
	publicationLanguage = sourceLanguage = 'en';
	progress.length = 0;
	await activateDraftLanguages('token', newsletter, '123', language => progress.push(language));
	assert.deepEqual(progress, ['es', 'de', 'it', 'pt', 'fr']);
	editions = [];
	progress.length = 0;
	await activateDraftLanguages('token', newsletter, '123', language => progress.push(language), ['en', 'de', 'it']);
	assert.deepEqual(progress, ['de', 'it'], 'Only selected languages other than the original must be added');
	const beforeUnchecked = requests.length;
	assert.equal(await activateDraftLanguages('token', newsletter, '123', () => assert.fail('No language selected'), []), false);
	assert.equal(requests.length, beforeUnchecked, 'Unchecking every language must disable all translation requests');
	editions = [];
	persistEdition = false;
	await assert.rejects(activateDraftLanguages('token', newsletter, '123', () => {}), /brouillon est créé/);
	persistEdition = true;
	translationStatus = 500;
	const beforeTranslationFailure = requests.length;
	await assert.rejects(activateDraftLanguages('token', newsletter, '123', () => {}), /Substack/);
	assert.equal(requests.slice(beforeTranslationFailure).filter(request => request.method === 'POST').length, 1, 'Failed language requests must not be retried or create another draft');
	translationStatus = 200;
	editions = [{ language: 'es', draft_body: null }];
	const beforeIncomplete = requests.length;
	await assert.rejects(activateDraftLanguages('token', newsletter, '123', () => {}), /brouillon est créé/);
	assert.equal(requests.slice(beforeIncomplete).some(request => request.method === 'POST'), false, 'Existing incomplete editions must not be overwritten');
	editions = [];
	let notifyTranslation;
	const translationStarted = new Promise(resolve => { notifyTranslation = resolve; });
	respond = request => request.method === 'POST' ? (notifyTranslation(), new Promise(() => {})) : translated(request);
	const translationTimeout = activateDraftLanguages('token', newsletter, '123', () => {});
	await translationStarted;
	assert.equal(timers.size, 1);
	[...timers.values()][0]();
	await assert.rejects(translationTimeout, /Vérifiez les brouillons/);
	assert.equal(timers.size, 0);
	const beforeInvalidDraft = requests.length;
	await assert.rejects(activateDraftLanguages('token', newsletter, '../123', () => {}), /invalide/);
	assert.equal(requests.length, beforeInvalidDraft);
	console.log('Draft languages: disabled setting, existing editions, French fallback, read-back confirmation, failures and deadlines pass.');

	const plugin = new moduleForCheck.exports.default();
	await plugin.onload();
	assert.equal(plugin.tab.icon, 'to-substack');
	assert.equal(plugin.account, null);
	assert.equal(plugin.settings.translationLanguages.join(','), 'en,es,de,it,pt,fr');
	assert.equal(plugin.tab.getSettingDefinitions()[2].items.map(item => item.name).join(','), 'Anglais,Espagnol,Allemand,Italien,Portugais,Français');
	await plugin.tab.setControlValue('sessionSecretId', 'session-importee');
	secrets.set('session-importee', 'fixture-session');
	respond = () => ({ status: 200, json: profile });
	await plugin.connect(false);
	assert.equal(plugin.account.newsletters.length, 2);
	assert.equal(plugin.tab.getSettingDefinitions()[1].items.length, 2);
	assert.equal(Object.keys(plugin.saved).join(','), 'sessionSecretId,translationLanguages');
	assert.equal(JSON.stringify(plugin.saved).includes('fixture-session'), false);
	const connectedAccount = plugin.account;
	await plugin.tab.setControlValue('translationLanguages', ['de', 'it']);
	assert.equal(plugin.account, connectedAccount, 'Choosing languages must keep the account connected');
	assert.equal(plugin.saved.translationLanguages.join(','), 'de,it');
	assert.equal(plugin.saved.sessionSecretId, 'session-importee');
	await plugin.disconnect();
	assert.equal(plugin.account, null);
	assert.equal(plugin.settings.sessionSecretId, '');
	assert.equal(plugin.saved.sessionSecretId, '');
	assert.equal(plugin.saved.translationLanguages.join(','), 'de,it', 'Disconnecting must preserve language preferences');
	assert.equal(secrets.get('session-importee'), 'fixture-session', 'Imported shared secrets belong to the user');
	for (const [savedPreferences, expected] of [
		[{ sessionSecretId: '' }, 'en,es,de,it,pt,fr'],
		[{ translationLanguages: ['it', 'de', 'it', 'unknown', null] }, 'de,it'],
		[{ translationLanguages: [] }, ''],
		[{ translationLanguages: 'de' }, 'en,es,de,it,pt,fr']
	]) {
		const reloaded = new moduleForCheck.exports.default();
		reloaded.saved = savedPreferences;
		await reloaded.onload();
		assert.equal(reloaded.settings.translationLanguages.join(','), expected);
	}

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
