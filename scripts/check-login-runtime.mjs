import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { buildSync } from 'esbuild';

assert.equal(process.platform, 'darwin', 'This check requires Obsidian for macOS');
const obsidianProfile = path.join(os.homedir(), 'Library/Application Support/obsidian');
const archives = (await fs.readdir(obsidianProfile)).filter(name => /^obsidian-\d.*\.asar$/.test(name));
archives.sort((left, right) => right.localeCompare(left, 'en', { numeric: true }));
assert.ok(archives.length, 'An installed Obsidian archive is required');
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'to-substack-settings-'));
const profile = path.join(root, 'profile');
const vault = path.join(root, 'vault');
const destination = path.join(vault, '.obsidian/plugins/to-substack');
await fs.mkdir(destination, { recursive: true });
await fs.mkdir(profile);
for (const name of ['manifest.json', 'styles.css']) await fs.copyFile(name, path.join(destination, name));
const bundle = await fs.readFile('main.js', 'utf8');
const iconPath = (await fs.readFile('icon.svg', 'utf8')).match(/<path d="([^"]+)"/)[1];
const postBundle = buildSync({ stdin: { contents: "export * from './plugin/post'; export * from './plugin/i18n'; export * from './plugin/settings'; export { MarkdownPreviewRenderer, Menu } from 'obsidian';", resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, format: 'cjs', external: ['obsidian'] }).outputFiles[0].text;
const prefix = `const hostRequire = require;
const host = hostRequire('obsidian');
globalThis.toSubstackTestRequests = [];
globalThis.toSubstackValidatedSessions = [];
globalThis.toSubstackTestDenied = true;
globalThis.toSubstackTestPending = false;
globalThis.toSubstackPendingResponses = [];
globalThis.toSubstackDrafts = [];
globalThis.toSubstackImageUploads = [];
const fixtureApi = { ...host, requestUrl: async options => {
 if (options.method === 'GET' && ['https://premiere-fixture.substack.com/api/v1/publication_settings', 'https://deuxieme-fixture.substack.com/api/v1/publication_settings'].includes(options.url)) return new Promise(resolve => { globalThis.toSubstackFinishLanguages = resolve; });
 if (options.method === 'POST' && ['https://premiere-fixture.substack.com/api/v1/image', 'https://deuxieme-fixture.substack.com/api/v1/image'].includes(options.url)) {
  globalThis.toSubstackImageUploads.push({ url: options.url, contentType: options.headers['Content-Type'], image: new URLSearchParams(options.body).get('image') });
  if (globalThis.toSubstackImageFailure) return { status: 500 };
  return { status: 200, json: { url: 'https://images.example.invalid/pixel.png' } };
 }
 if (options.method === 'POST' && ['https://premiere-fixture.substack.com/api/v1/drafts', 'https://deuxieme-fixture.substack.com/api/v1/drafts'].includes(options.url)) {
  globalThis.toSubstackDrafts.push({ url: options.url, body: JSON.parse(options.body) });
  await new Promise(resolve => { globalThis.toSubstackFinishDraft = resolve; });
  return { status: 200, json: { id: 123 } };
 }
 if (options.url !== 'https://substack.com/api/v1/user/profile/self' || options.method !== 'GET') throw Error('Unexpected network request');
 globalThis.toSubstackTestRequests.push({ url: options.url, method: options.method });
 if (globalThis.toSubstackTestPending) await new Promise(resolve => globalThis.toSubstackPendingResponses.push(resolve));
 if (globalThis.toSubstackTestDenied || !options.headers.Cookie.split(';').some(part => part.trim() === 'substack.sid=fixture-desktop-session')) return { status: 401 };
 globalThis.toSubstackValidatedSessions.push(options.headers.Cookie);
 return { status: 200, json: { name: 'Compte de test', publicationUsers: [
  { publication: { name: 'Newsletter principale', subdomain: 'premiere-fixture' } },
  { publication: { name: 'Deuxième newsletter', subdomain: 'deuxieme-fixture' } }
 ] } };
} };
(function(require, module, exports) {
`;
const requireFixture = 'name => name === "obsidian" ? fixtureApi : hostRequire(name)';
await fs.writeFile(path.join(destination, 'main.js'), prefix + bundle + `\n})(${requireFixture}, module, exports);\nconst postCheckModule = { exports: {} };\n(function(require, module, exports) {\n` + postBundle + `\n})(${requireFixture}, postCheckModule, postCheckModule.exports);\npostCheckModule.exports.setLocale(host.getLanguage());\nglobalThis.toSubstackPreparePost = postCheckModule.exports.preparePost;\nglobalThis.toSubstackUiCheck = postCheckModule.exports;\n`);
await fs.writeFile(path.join(vault, '.obsidian/community-plugins.json'), '["to-substack"]');
await fs.writeFile(path.join(vault, '.obsidian/core-plugins.json'), '["file-explorer"]');
await fs.writeFile(path.join(vault, '.obsidian/app.json'), '{}');
await fs.writeFile(path.join(vault, 'Test.md'), '---\ntitle: Ignorer les propriétés\n---\n# Un titre **en gras**\n\n*Un chapeau avec [un lien](https://example.org).*\n\nPremier paragraphe **gras** et *italique*.\n\n## Une section\n\n- Une entrée\n- Une autre\n\n> Une citation\n');
const pixelBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
await fs.mkdir(path.join(vault, 'assets'));
await fs.writeFile(path.join(vault, 'assets/pixel test.png'), Buffer.from(pixelBase64, 'base64'));
await fs.appendFile(path.join(vault, 'Test.md'), '\n![[assets/pixel test.png|Petit pixel]]\n\n![Image Markdown](assets/pixel%20test.png)\n');
await fs.writeFile(path.join(profile, 'obsidian.json'), JSON.stringify({ vaults: { fedcba0987654321: { path: vault, ts: Date.now(), open: true } } }));
await fs.copyFile(path.join(obsidianProfile, archives[0]), path.join(profile, archives[0]));
const child = spawn('/Applications/Obsidian.app/Contents/MacOS/Obsidian', [
 `--user-data-dir=${profile}`, '--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1', '--disable-gpu', '--no-first-run', '--disable-background-networking'
], { stdio: ['ignore', 'ignore', 'pipe'] });
let stderr = '';
child.stderr.on('data', chunk => { stderr += chunk; });
const closed = new Promise(resolve => child.once('close', resolve));
const sockets = new Map();
let main;
let settings;
let pageList;
async function poll(check, label) {
 const deadline = Date.now() + 25000;
 let last;
 while (Date.now() < deadline) {
  try { const result = await check(); if (result) return result; } catch (error) { last = error; }
  await new Promise(resolve => setTimeout(resolve, 100));
 }
 throw Error(`${label}: ${last?.message ?? 'condition not reached'}`);
}
async function connect(target) {
 if (sockets.has(target.id)) return sockets.get(target.id);
 const socket = new WebSocket(target.webSocketDebuggerUrl);
 await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
 let id = 0;
 const pending = new Map();
 socket.addEventListener('message', event => {
  const result = JSON.parse(event.data);
  const request = pending.get(result.id);
  if (request) { pending.delete(result.id); result.error ? request.reject(Error(JSON.stringify(result.error))) : request.resolve(result.result); }
 });
 const call = (method, params = {}) => new Promise((resolve, reject) => {
  const seq = ++id;
  const timeout = setTimeout(() => { pending.delete(seq); reject(Error(`CDP timeout: ${method}`)); }, 10000);
  pending.set(seq, { resolve: value => { clearTimeout(timeout); resolve(value); }, reject: error => { clearTimeout(timeout); reject(error); } });
  socket.send(JSON.stringify({ id: seq, method, params }));
 });
 const connection = { socket, call, async evaluate(expression) {
  const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
  return result.result.value;
 } };
 sockets.set(target.id, connection);
 return connection;
}
async function clickButton(label) {
 const point = await poll(() => settings.evaluate(`(() => {
  const button = [...document.querySelectorAll('button')].find(node => node.textContent.trim() === ${JSON.stringify(label)} && !node.disabled);
  if (!button) return null;
  const box = button.getBoundingClientRect();
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
 })()`), `Button ${label}`);
 await settings.call('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 });
 await settings.call('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 });
}
async function observeLoginLifecycle() {
 await main.evaluate(`(() => {
  const win = app.plugins.getPlugin('to-substack').login.authWindow;
  const request = win.webContents.session.webRequest;
  const remove = request.onBeforeRequest.bind(request);
  const destroy = win.destroy.bind(win);
  const electron = window.require('electron');
  const parent = (electron.remote ?? electron).BrowserWindow.fromId(globalThis.toSubstackSettingsWindowId);
  const state = globalThis.toSubstackLoginLifecycle = { detached: false };
  request.onBeforeRequest = listener => { state.detached = listener === null; return remove(listener); };
  win.destroy = () => {
   state.detachedBeforeDestroy = state.detached;
   state.hiddenBeforeDestroy = !win.isVisible();
   state.parentFocusedBeforeDestroy = parent.isFocused();
   destroy();
  };
 })()`);
}

async function checkExportOptions() {
 const result = await main.evaluate(`(${(async function () {
  const { preparePost } = globalThis.toSubstackUiCheck;
  const source = '---\nmetadescription: >-\n  YAML description\n  on two lines.\n---\n# Article title\n\nBody with #inside.\n\n#carnets #y2026 #2026-11-2-10h00\n';
  const file = await app.vault.create('Export metadata.md', source);
  const regular = await preparePost(app, file);
  const cleaned = await preparePost(app, file, { removeTrailingTags: true });
  const note = await preparePost(app, file, { forNote: true, removeTrailingTags: true });
  const italicFile = await app.vault.create('Export italic.md', '---\nmetadescription: YAML description\n---\n# Title\n\n*Italic subtitle.*\n\nBody.');
  const italic = await preparePost(app, italicFile);
  const protectedFile = await app.vault.create('Export code tags.md', 'Text.\n\n`#keep-code`\n\n```\n#keep-fenced\n```');
  const protectedTags = await preparePost(app, protectedFile, { removeTrailingTags: true });
  const multipleFile = await app.vault.create('Export multiple tags.md', 'Body.\n\n#first  \n#second\n\n#last');
  const multiple = await preparePost(app, multipleFile, { removeTrailingTags: true });
  const selectionSource = 'OUTSIDE\n\nOnly **this**.\n\n![[missing-unselected.png]]';
  const selectionFile = await app.vault.create('Export selection.md', selectionSource);
  const selection = await preparePost(app, selectionFile, { forNote: true, selection: 'Only **this**.\n\n![[assets/pixel test.png]]\n\n#selected', removeTrailingTags: true });
  const whitespace = await preparePost(app, selectionFile, { forNote: true, selection: '   ' });
  const rawSelection = await preparePost(app, selectionFile, { forNote: true, selection: '---\nRaw selection\n---' });
  return { regular, cleaned, note, italic, protectedTags, multiple, selection, whitespace, rawSelection,
   original: await app.vault.read(file), source };
 }).toString()})()`);
 assert.equal(result.regular.subtitle, 'YAML description on two lines.');
 assert.equal(result.italic.subtitle, 'Italic subtitle.');
 assert.equal(JSON.stringify(result.italic.body).includes('Italic subtitle.'), false);
 assert.equal(JSON.stringify(result.regular.body).includes('#carnets'), true);
 assert.equal(JSON.stringify(result.cleaned.body).includes('#carnets'), false);
 assert.equal(JSON.stringify(result.cleaned.body).includes('#inside'), true);
 assert.equal(result.note.subtitle, '');
 assert.equal(result.note.body.content[0].type, 'heading');
 assert.equal(JSON.stringify(result.protectedTags.body).includes('#keep-code'), true);
 assert.equal(JSON.stringify(result.protectedTags.body).includes('#keep-fenced'), true);
 assert.equal(result.multiple.body.content.length, 1);
 assert.equal(JSON.stringify(result.selection.body).includes('OUTSIDE'), false);
 assert.equal(JSON.stringify(result.selection.body).includes('#selected'), false);
 assert.ok(result.selection.body.content.some(node => node.type === 'image2'));
 assert.deepEqual(result.whitespace.body.content, [{ type: 'paragraph' }]);
 assert.equal(JSON.stringify(result.rawSelection.body).includes('Raw selection'), true);
 assert.equal(result.original, result.source);
 await main.evaluate(`(async () => {
  app.setting.close();
  const electron = window.require('electron');
  const remote = electron.remote ?? electron;
  const mainWindow = remote.BrowserWindow.getAllWindows().find(win => win.webContents.getURL() === 'app://obsidian.md/index.html');
  for (const win of remote.BrowserWindow.getAllWindows()) if (win.id !== mainWindow.id) win.close();
  remote.app.focus({ steal: true });
  mainWindow.show(); mainWindow.focus();
  const leaf = app.workspace.getLeaf(true);
  globalThis.toSubstackExportLeaf = leaf;
  await leaf.openFile(app.vault.getFileByPath('Export selection.md'), { state: { mode: 'source' } });
  app.workspace.setActiveLeaf(leaf, { focus: true });
 })()`);
 try {
  for (const [event, selected, expected] of [
   ['editor-menu', true, ['Note']], ['file-menu', true, ['Note']],
   ['editor-menu', false, ['Note', 'Newsletter principale', 'Deuxième newsletter']]
  ]) {
   const state = await main.evaluate(`(() => {
    const view = globalThis.toSubstackExportLeaf.view;
    view.editor.setSelection({ line: 2, ch: 0 }, { line: 2, ch: ${selected ? 'Only **this**.'.length : 0} });
    const menu = new globalThis.toSubstackUiCheck.Menu();
    if (${JSON.stringify(event)} === 'editor-menu') app.workspace.trigger('editor-menu', menu, view.editor, view);
    else app.workspace.trigger('file-menu', menu, view.file, 'file-explorer-context-menu', globalThis.toSubstackExportLeaf);
    const item = menu.items.find(item => item.titleEl.textContent.trim() === 'To Substack');
    if (!item) throw Error('To Substack menu item missing');
    const state = { selection: view.editor.getSelection(), newsletters: app.plugins.getPlugin('to-substack').account.newsletters.map(newsletter => newsletter.name) };
    view.editor.setCursor({ line: 0, ch: 0 });
    item.callback(new MouseEvent('click'));
    return state;
   })()`);
   assert.equal(state.selection, selected ? 'Only **this**.' : '');
   assert.deepEqual(state.newsletters, ['Newsletter principale', 'Deuxième newsletter']);
   const options = await poll(() => main.evaluate(`(() => { const select = document.querySelector('.modal select'); return select ? [...select.options].map(option => option.text) : null; })()`), `${event} destinations`);
   assert.deepEqual(options, expected, `${event}, selected=${selected}`);
   await main.call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
   await main.call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
   await poll(() => main.evaluate(`!document.querySelector('.modal select')`), 'Export dialog closed');
  }
 } finally { await main.evaluate(`globalThis.toSubstackExportLeaf.detach(); delete globalThis.toSubstackExportLeaf;`); }
 console.log('Native export: selected-text destinations, YAML fallback, italic priority, trailing tags and source preservation pass.');
}

try {
 const port = await poll(async () => Number((await fs.readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]), 'Debugging port');
 const pages = async () => (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
 pageList = pages;
 main = await connect(await poll(async () => (await pages()).find(page => page.type === 'page' && page.url === 'app://obsidian.md/index.html'), 'Main page'));
 await poll(() => main.evaluate(`Boolean(globalThis.app?.workspace?.layoutReady && app.vault.adapter.getBasePath() === ${JSON.stringify(vault)})`), 'Vault startup');
 const trustPoint = await poll(() => main.evaluate(`(() => {
  const button = [...document.querySelectorAll('.modal button')].find(node => node.textContent.trim() === "Faire confiance à l'auteur et activer les modules");
  if (!button) return null;
  const box = button.getBoundingClientRect(); return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
 })()`), 'Trust dialog for the fixture vault');
 await main.call('Input.dispatchMouseEvent', { type: 'mousePressed', ...trustPoint, button: 'left', clickCount: 1 });
 await main.call('Input.dispatchMouseEvent', { type: 'mouseReleased', ...trustPoint, button: 'left', clickCount: 1 });
 await poll(() => main.evaluate(`!document.querySelector('.modal') && Boolean(app.plugins.getPlugin('to-substack'))`), 'Fixture plugin enabled through vault trust');
 const initial = await main.evaluate(`(async () => {
  if (!app.plugins.isEnabled()) await app.plugins.setEnable(true);
  if (!app.plugins.getPlugin('to-substack')) await app.plugins.loadPlugin('to-substack');
  const plugin = app.plugins.getPlugin('to-substack');
  if (!plugin) throw Error('Plugin did not load');
  app.setting.open(); app.setting.openTabById('to-substack');
  const electron = window.require('electron');
  return { connected: plugin.account !== null, browserWindowAvailable: typeof (electron.remote ?? electron).BrowserWindow === 'function' };
 })()`);
 assert.equal(initial.connected, false);
 assert.equal(initial.browserWindowAvailable, true);
 await poll(async () => {
  for (const page of (await pages()).filter(page => page.type === 'page')) {
   const connection = await connect(page);
   if (await connection.evaluate(`Boolean(document.querySelector('.vertical-tab-nav-item[data-setting-id="to-substack"]'))`)) { settings = connection; return true; }
  }
 }, 'Settings page');
 const text = () => settings.evaluate(`document.body.textContent`);
 await poll(async () => (await text()).includes('Connexion manuelle'), 'Initial settings');
 assert.equal(await settings.evaluate(`document.querySelector('.vertical-tab-nav-item[data-setting-id="to-substack"] svg path')?.getAttribute('d')`), iconPath, 'Settings must display the bundled Substack logo');
 assert.ok((await text()).includes('Connectez-vous pour charger vos newsletters'));
 const secretControl = await settings.evaluate(`(() => {
  const row = [...document.querySelectorAll('.setting-item')].find(row => row.querySelector('.setting-item-name')?.textContent === 'Session Substack');
  return !!row?.querySelector('.setting-item-control')?.children.length;
 })()`);
 assert.equal(secretControl, true);

 await main.evaluate(`(async () => {
  const electron = window.require('electron');
  const remote = electron.remote ?? electron;
  remote.app.focus({ steal: true });
  for (const win of remote.BrowserWindow.getAllWindows()) {
   if (await win.webContents.executeJavaScript(${JSON.stringify("Boolean(document.querySelector('.vertical-tab-nav-item[data-setting-id=\"to-substack\"]'))")})) {
    globalThis.toSubstackSettingsWindowId = win.id;
    win.show(); win.focus();
    return;
   }
  }
  throw Error('Settings native window not found');
 })()`);
 await poll(() => main.evaluate(`(() => { const electron = window.require('electron'); return (electron.remote ?? electron).BrowserWindow.fromId(globalThis.toSubstackSettingsWindowId)?.isFocused(); })()`), 'Settings window focused before login');
 await clickButton('Se connecter');
 await poll(() => main.evaluate(`app.plugins.getPlugin('to-substack').busy`), 'Login operation');
 await observeLoginLifecycle();
 const sandbox = await main.evaluate(`(() => {
  const electron = window.require('electron');
  const login = app.plugins.getPlugin('to-substack').login.authWindow;
  if (!login) throw Error('Login window missing');
  const preferences = login.webContents.getLastWebPreferences();
  return { sandbox: preferences.sandbox, nodeIntegration: preferences.nodeIntegration, contextIsolation: preferences.contextIsolation, persistent: login.webContents.session.isPersistent() };
 })()`);
 assert.deepEqual(sandbox, { sandbox: true, nodeIntegration: false, contextIsolation: true, persistent: false });
 const redirectTarget = 'https://substack.com/sign-in?to-substack-navigation-check=1';
 await main.evaluate(`app.plugins.getPlugin('to-substack').login.authWindow.webContents.executeJavaScript(${JSON.stringify(`
  globalThis.toSubstackExternalAttempt = false;
  window.addEventListener('open-url', event => { globalThis.toSubstackExternalAttempt = true; event.preventDefault(); });
  location.assign(${JSON.stringify(redirectTarget)});
  true;
 `)})`);
 const navigationResult = await poll(() => main.evaluate(`(async () => {
  const contents = app.plugins.getPlugin('to-substack').login.authWindow.webContents;
  if (contents.getURL() === ${JSON.stringify(redirectTarget)}) return 'internal';
  return await contents.executeJavaScript('Boolean(globalThis.toSubstackExternalAttempt)') ? 'external' : null;
 })()`), 'Post-verification redirect');
 assert.equal(navigationResult, 'internal', 'Substack page navigation must stay in the login window rather than invoke the external browser');
 const blockedNavigationCodes = await main.evaluate(`(async () => {
  const login = app.plugins.getPlugin('to-substack').login.authWindow;
  const errors = [];
  for (const url of ['http://substack.com/', 'https://substack.com.attacker.invalid/']) {
   try { await login.loadURL(url); errors.push('allowed'); }
   catch (error) { errors.push(error.code); }
  }
  await login.loadURL(${JSON.stringify(redirectTarget)});
  return errors;
 })()`);
 assert.deepEqual(blockedNavigationCodes, ['ERR_BLOCKED_BY_CLIENT', 'ERR_BLOCKED_BY_CLIENT'], 'The isolated session must reject insecure and foreign main-frame requests');
 assert.equal(await main.evaluate(`app.plugins.getPlugin('to-substack').login.authWindow.webContents.executeJavaScript('window.open("https://substack.com/sign-in?to-substack-popup-check=1") === null')`), true, 'Popup requests must be denied synchronously without opening the system browser');
 assert.equal(await main.evaluate(`(() => {
  const plugin = app.plugins.getPlugin('to-substack');
  return plugin.login.authWindow.getParentWindow()?.id === globalThis.toSubstackSettingsWindowId;
 })()`), true, 'The login window must be a child of the settings window');

 assert.equal(await settings.evaluate(`(() => {
  const button = [...document.querySelectorAll('button')].find(node => node.textContent.trim() === 'Revenir à la connexion');
  return !!button && !button.disabled;
 })()`), true, 'The pending login must offer an enabled return button');
 await main.evaluate(`(() => { const plugin = app.plugins.getPlugin('to-substack'); const focus = plugin.login.focus.bind(plugin.login); plugin.login.focus = () => { globalThis.toSubstackFocusCalls = (globalThis.toSubstackFocusCalls || 0) + 1; focus(); }; })()`);
 const originalLoginId = await main.evaluate(`(() => {
  const electron = window.require('electron');
  const login = app.plugins.getPlugin('to-substack').login.authWindow;
  login.minimize();
  return login.id;
 })()`);
 await poll(() => main.evaluate(`(() => { const electron = window.require('electron'); return (electron.remote ?? electron).BrowserWindow.fromId(${originalLoginId})?.isMinimized(); })()`), 'Login minimized');
 const originalWindowCount = await main.evaluate(`(() => { const electron = window.require('electron'); return (electron.remote ?? electron).BrowserWindow.getAllWindows().length; })()`);
 await clickButton('Revenir à la connexion');
 await poll(() => main.evaluate(`(() => {
  const electron = window.require('electron');
  const login = (electron.remote ?? electron).BrowserWindow.fromId(${originalLoginId});
  return !!login && !login.isMinimized() && login.isVisible() && login.isFocused();
 })()`), 'Return to the same login window');
 assert.equal(await main.evaluate(`(() => {
  const electron = window.require('electron');
  return (electron.remote ?? electron).BrowserWindow.getAllWindows().length;
 })()`), originalWindowCount, 'Returning must preserve the login session and avoid a second window');

 await main.evaluate(`(async () => {
  const electron = window.require('electron');
  const login = app.plugins.getPlugin('to-substack').login.authWindow;
  await login.webContents.session.cookies.set({ url: 'https://substack.com', name: 'substack.sid', value: 'fixture-before-email-code', secure: true, httpOnly: true });
 })()`);
 await poll(() => main.evaluate(`globalThis.toSubstackTestRequests.length > 0`), 'Pre-authentication cookie checked');
 assert.equal(await main.evaluate(`(() => {
  const electron = window.require('electron');
  const login = app.plugins.getPlugin('to-substack').login.authWindow;
  return !!login && app.plugins.getPlugin('to-substack').busy;
 })()`), true, 'A pre-authentication cookie must not close the login window');
 await main.evaluate(`app.plugins.getPlugin('to-substack').login.authWindow.webContents.executeJavaScript('window.onbeforeunload = () => false; true')`);
 const beforeVerifiedCookie = await main.evaluate(`globalThis.toSubstackTestRequests.length`);
 await main.evaluate(`(async () => {
  const electron = window.require('electron');
  const login = app.plugins.getPlugin('to-substack').login.authWindow;
  await login.webContents.session.cookies.set({ url: 'https://substack.com', name: 'substack.sid', value: 'fixture-desktop-session', secure: true, httpOnly: true });
 })()`);
 await poll(() => main.evaluate(`globalThis.toSubstackTestRequests.length > ${beforeVerifiedCookie}`), 'Cookie checked before SPA navigation');
 assert.equal(await main.evaluate(`app.plugins.getPlugin('to-substack').hasLoginWindow`), true);
 await main.evaluate(`globalThis.toSubstackTestDenied = false`);
 await main.evaluate(`app.plugins.getPlugin('to-substack').login.authWindow.webContents.executeJavaScript('history.pushState({}, "", "/home"); true')`);
 await poll(() => main.evaluate(`app.plugins.getPlugin('to-substack').account?.newsletters.length === 2`), 'Captured session and newsletters');
 assert.deepEqual(await main.evaluate(`globalThis.toSubstackLoginLifecycle`), { detached: true, detachedBeforeDestroy: true, hiddenBeforeDestroy: true, parentFocusedBeforeDestroy: true }, 'Login cleanup must finish after detaching network callbacks and returning focus to settings');
 assert.equal(await main.evaluate(`(() => { const electron = window.require('electron'); return !!(electron.remote ?? electron).BrowserWindow.fromId(${originalLoginId}); })()`), false, 'Completed login must close even when the page refuses unload');
 await poll(() => main.evaluate(`(() => { const electron = window.require('electron'); return (electron.remote ?? electron).BrowserWindow.fromId(globalThis.toSubstackSettingsWindowId)?.isFocused(); })()`), 'Return to the settings window after authentication');
 await poll(async () => (await text()).includes('Deuxième newsletter'), 'Newsletter settings rendering');
 assert.ok((await text()).includes('Newsletter principale'));
 assert.equal((await text()).includes('fixture-desktop-session'), false);
 const saved = await main.evaluate(`(async () => {
  const plugin = app.plugins.getPlugin('to-substack');
  const saved = await plugin.loadData();
  return { keys: Object.keys(saved), reference: saved.sessionSecretId, stored: globalThis.toSubstackValidatedSessions.includes(app.secretStorage.getSecret(saved.sessionSecretId)), cookieNames: (app.secretStorage.getSecret(saved.sessionSecretId) || '').split(';').map(part => part.trim().split('=')[0]) };
 })()`);
 if (!saved.stored) console.error('STORED COOKIE NAMES', JSON.stringify(saved.cookieNames));
 delete saved.cookieNames;
 assert.deepEqual(saved, { keys: ['sessionSecretId', 'defaultLanguage', 'translationLanguages', 'removeTrailingTags'], reference: 'obsidian-to-substack-session', stored: true });

 await main.evaluate(`globalThis.toSubstackTestDenied = true`);
 await clickButton('Actualiser');
 await poll(async () => (await text()).includes('Session refusée ou expirée'), 'Visible session error');
 assert.equal(await settings.evaluate(`Boolean(document.querySelector('[role="alert"]'))`), true);
 await main.evaluate(`globalThis.toSubstackTestDenied = false`);
 await clickButton('Actualiser');
 await poll(async () => (await text()).includes('Deuxième newsletter'), 'Session retry');
 await clickButton('Se déconnecter');
 await poll(async () => (await text()).includes('Connectez-vous pour charger vos newsletters') && !(await text()).includes('Deuxième newsletter'), 'Disconnect rendering');
 assert.equal(await main.evaluate(`app.secretStorage.getSecret('obsidian-to-substack-session')`), '');
 assert.equal(await main.evaluate(`app.plugins.getPlugin('to-substack').settings.sessionSecretId`), '');
 await main.evaluate(`globalThis.toSubstackTestDenied = true`);
 await clickButton('Se connecter');
 const quietLoginId = await main.evaluate(`app.plugins.getPlugin('to-substack').login.authWindow.id`);
 await main.evaluate(`app.plugins.getPlugin('to-substack').login.authWindow.loadURL('about:blank')`);
 const beforeQuietCookie = await main.evaluate(`globalThis.toSubstackTestRequests.length`);
 await main.evaluate(`app.plugins.getPlugin('to-substack').login.authWindow.webContents.session.cookies.set({ url: 'https://substack.com', name: 'substack.sid', value: 'fixture-desktop-session', secure: true, httpOnly: true })`);
 await poll(() => main.evaluate(`globalThis.toSubstackTestRequests.length > ${beforeQuietCookie}`), 'Session rejected before server-side authentication');
 assert.equal(await main.evaluate(`app.plugins.getPlugin('to-substack').hasLoginWindow`), true);
 await main.evaluate(`(() => {
  const electron = window.require('electron');
  (electron.remote ?? electron).BrowserWindow.fromId(globalThis.toSubstackSettingsWindowId).hide();
  globalThis.toSubstackTestDenied = false;
 })()`);
 await poll(() => main.evaluate(`app.plugins.getPlugin('to-substack').account?.newsletters.length === 2`), 'Automatic return without navigation or cookie change');
 assert.equal(await main.evaluate(`(() => { const electron = window.require('electron'); return !!(electron.remote ?? electron).BrowserWindow.fromId(${quietLoginId}); })()`), false);
 await poll(() => main.evaluate(`(() => { const electron = window.require('electron'); const settingsWindow = (electron.remote ?? electron).BrowserWindow.fromId(globalThis.toSubstackSettingsWindowId); return settingsWindow.isVisible() && settingsWindow.isFocused(); })()`), 'Hidden settings restored automatically');
 await clickButton('Se déconnecter');
 await poll(() => main.evaluate(`!app.plugins.getPlugin('to-substack').settings.sessionSecretId`), 'Quiet authentication disconnected');
 await main.evaluate(`globalThis.toSubstackTestPending = true`);
 await clickButton('Se connecter');
 const cancelledLoginId = await main.evaluate(`app.plugins.getPlugin('to-substack').login.authWindow.id`);
 await main.evaluate(`(async () => {
  const login = app.plugins.getPlugin('to-substack').login.authWindow;
  await login.webContents.executeJavaScript('window.onbeforeunload = () => false; true');
  await login.webContents.session.cookies.set({ url: 'https://substack.com', name: 'substack.sid', value: 'fixture-desktop-session', secure: true, httpOnly: true });
 })()`);
 await poll(() => main.evaluate(`globalThis.toSubstackPendingResponses.length > 0`), 'Pending account request');
 await clickButton('Annuler');
 await poll(() => main.evaluate(`!app.plugins.getPlugin('to-substack').busy`), 'Cancelled login');
 assert.equal(await main.evaluate(`(() => { const electron = window.require('electron'); return !!(electron.remote ?? electron).BrowserWindow.fromId(${cancelledLoginId}); })()`), false, 'Cancel must destroy the window despite beforeunload');
 await main.evaluate(`globalThis.toSubstackTestPending = false; globalThis.toSubstackPendingResponses.splice(0).forEach(resolve => resolve());`);
 await poll(() => main.evaluate(`!app.plugins.getPlugin('to-substack').hasLoginWindow`), 'No remaining login window');
 assert.equal(await main.evaluate(`app.plugins.getPlugin('to-substack').account`), null);
 assert.equal(await main.evaluate(`app.plugins.getPlugin('to-substack').settings.sessionSecretId`), '');
 await clickButton('Se connecter');
 await poll(() => main.evaluate(`app.plugins.getPlugin('to-substack').hasLoginWindow`), 'Retry after cancellation');
 await main.evaluate(`(async () => {
  const login = app.plugins.getPlugin('to-substack').login.authWindow;
  await login.webContents.executeJavaScript('window.onbeforeunload = () => false; true');
  login.close();
 })()`);
 await poll(() => main.evaluate(`!app.plugins.getPlugin('to-substack').busy && !app.plugins.getPlugin('to-substack').hasLoginWindow`), 'Native close despite beforeunload');
 const otherTab = await settings.evaluate(`(() => {
  const tab = [...document.querySelectorAll('.vertical-tab-nav-item[data-setting-id]')].find(node => node.dataset.settingId !== 'to-substack');
  const box = tab.getBoundingClientRect();
  return { id: tab.dataset.settingId, x: box.x + box.width / 2, y: box.y + box.height / 2 };
 })()`);
 await settings.call('Input.dispatchMouseEvent', { type: 'mousePressed', x: otherTab.x, y: otherTab.y, button: 'left', clickCount: 1 });
 await settings.call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: otherTab.x, y: otherTab.y, button: 'left', clickCount: 1 });
 await poll(() => settings.evaluate(`document.querySelector('.vertical-tab-nav-item.is-active')?.dataset.settingId === ${JSON.stringify(otherTab.id)}`), 'Other settings tabs remain clickable');
 await main.evaluate(`(() => { const electron = window.require('electron'); (electron.remote ?? electron).BrowserWindow.fromId(globalThis.toSubstackSettingsWindowId).close(); })()`);
 await poll(() => main.evaluate(`(() => { const electron = window.require('electron'); return !(electron.remote ?? electron).BrowserWindow.fromId(globalThis.toSubstackSettingsWindowId); })()`), 'Settings window remains closable');
 await main.evaluate(`(async () => {
  const plugin = app.plugins.getPlugin('to-substack');
  app.secretStorage.setSecret('obsidian-to-substack-session', globalThis.toSubstackValidatedSessions[0]);
  plugin.settings.sessionSecretId = 'obsidian-to-substack-session';
  await plugin.connect(false);
  app.workspace.leftSplit.expand();
  const electron = window.require('electron');
  const remote = electron.remote ?? electron;
  const mainWindow = remote.BrowserWindow.getAllWindows().find(win => win.webContents.getURL() === 'app://obsidian.md/index.html');
  for (const win of remote.BrowserWindow.getAllWindows()) if (win.id !== mainWindow.id) win.close();
  remote.app.focus({ steal: true });
  mainWindow.show(); mainWindow.focus();
  globalThis.toSubstackExplorerEvents = [];
  app.workspace.on('file-menu', (menu, file, source) => {
   globalThis.toSubstackExplorerEvents.push({ kind: 'file-menu', path: file.path, source, keys: Object.keys(menu) });
   menu.setUseNativeMenu(false);
  });
  document.addEventListener('contextmenu', event => { globalThis.toSubstackExplorerEvents.push({ kind: 'contextmenu', target: event.target.className, path: event.target.closest('[data-path]')?.dataset.path }); }, true);
 })()`);
 const notePoint = await poll(() => main.evaluate(`(() => {
  const item = document.querySelector('.nav-file-title[data-path="Test.md"], .nav-file[data-path="Test.md"] .nav-file-title');
  if (!item) return null;
  const box = item.getBoundingClientRect(); return box.width ? { x: box.x + box.width / 2, y: box.y + box.height / 2 } : null;
 })()`), 'Note in the native file explorer');
 await main.call('Input.dispatchMouseEvent', { type: 'mousePressed', ...notePoint, button: 'right', buttons: 2, clickCount: 1 });
 await main.call('Input.dispatchMouseEvent', { type: 'mouseReleased', ...notePoint, button: 'right', buttons: 0, clickCount: 1 });
 const postPoint = await poll(() => main.evaluate(`(() => {
  const item = [...document.querySelectorAll('.menu-item')].find(node => node.querySelector('.menu-item-title')?.textContent.trim() === 'To Substack');
  if (!item) return null;
  const box = item.getBoundingClientRect(); return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
 })()`), 'To Substack context menu item');
 assert.equal(await main.evaluate(`[...document.querySelectorAll('.menu-item')].find(node => node.querySelector('.menu-item-title')?.textContent.trim() === 'To Substack')?.querySelector('svg path')?.getAttribute('d')`), iconPath, 'The file menu must display the bundled Substack logo');
 await main.call('Input.dispatchMouseEvent', { type: 'mousePressed', ...postPoint, button: 'left', clickCount: 1 });
 await main.call('Input.dispatchMouseEvent', { type: 'mouseReleased', ...postPoint, button: 'left', clickCount: 1 });
 await poll(() => main.evaluate(`document.querySelector('.modal select')?.options.length === 3`), 'Note and newsletter destinations');
 assert.deepEqual(await main.evaluate(`[...document.querySelector('.modal select').options].map(option => option.text)`), ['Note', 'Newsletter principale', 'Deuxième newsletter']);
 // shortcut: The macOS picker needs a manual keyboard check; exercise the real select's change handler here.
 await main.evaluate(`(() => { const select = document.querySelector('.modal select'); select.value = select.options[0].value; select.dispatchEvent(new Event('change', { bubbles: true })); })()`);
 assert.equal(await main.evaluate(`[...document.querySelectorAll('.modal button')].some(button => button.textContent === 'Publier la note')`), true);
 assert.equal(await main.evaluate(`document.querySelector('.modal').textContent.includes('Publier immédiatement')`), true);
 await main.evaluate(`(() => { const select = document.querySelector('.modal select'); select.value = 'deuxieme-fixture'; select.dispatchEvent(new Event('change', { bubbles: true })); })()`);
 await poll(() => main.evaluate(`document.querySelector('.modal select').value === 'deuxieme-fixture'`), 'Second newsletter selected');
 const createPoint = await main.evaluate(`(() => { const button = [...document.querySelectorAll('.modal button')].find(node => node.textContent === 'Créer le brouillon'); const box = button.getBoundingClientRect(); return { x: box.x + box.width / 2, y: box.y + box.height / 2 }; })()`);
 for (let click = 0; click < 2; click++) {
  await main.call('Input.dispatchMouseEvent', { type: 'mousePressed', ...createPoint, button: 'left', clickCount: 1 });
  await main.call('Input.dispatchMouseEvent', { type: 'mouseReleased', ...createPoint, button: 'left', clickCount: 1 });
 }
 const creationResult = await poll(() => main.evaluate(`globalThis.toSubstackDrafts.length ? 'draft' : document.querySelector('.modal [role="alert"]')?.textContent`), 'Draft creation request');
 assert.equal(creationResult, 'draft', 'A note with local image embeds must create its draft');
 const drafts = await main.evaluate(`globalThis.toSubstackDrafts`);
 assert.equal(drafts.length, 1, 'Repeated clicks must not create duplicate posts');
 assert.equal(drafts[0].url, 'https://deuxieme-fixture.substack.com/api/v1/drafts');
 assert.equal(drafts[0].body.draft_title, 'Un titre en gras');
 assert.equal(drafts[0].body.draft_subtitle, 'Un chapeau avec un lien.');
 const postBody = JSON.parse(drafts[0].body.draft_body);
 const imageUploads = await main.evaluate(`globalThis.toSubstackImageUploads`);
 assert.equal(imageUploads.length, 1, 'The same local image used in wiki and Markdown embeds must be uploaded once');
 assert.equal(imageUploads[0].url, 'https://deuxieme-fixture.substack.com/api/v1/image');
 assert.equal(imageUploads[0].contentType, 'application/x-www-form-urlencoded');
 assert.equal(imageUploads[0].image, `data:image/png;base64,${pixelBase64}`);
 const images = postBody.content.filter(node => node.type === 'image2');
 assert.equal(images.length, 2);
 for (const image of images) assert.equal(image.attrs.src, 'https://images.example.invalid/pixel.png');
 assert.equal(images[0].attrs.alt, 'Petit pixel');
 assert.equal(images[1].attrs.alt, 'Image Markdown');
 assert.equal(postBody.type, 'doc');
 assert.equal(postBody.content[0].type, 'paragraph');
 assert.equal(postBody.content[0].content.map(node => node.text || '').join(''), 'Premier paragraphe gras et italique.');
 assert.ok(postBody.content[0].content.some(node => node.text === 'gras' && node.marks.some(mark => mark.type === 'strong')));
 assert.ok(postBody.content[0].content.some(node => node.text === 'italique' && node.marks.some(mark => mark.type === 'em')));
 assert.ok(postBody.content.some(node => node.type === 'heading' && node.attrs.level === 2));
 assert.ok(postBody.content.some(node => node.type === 'bulletList' && node.content.length === 2));
 assert.ok(postBody.content.some(node => node.type === 'blockquote'));
 assert.equal(JSON.stringify(postBody).includes('Un chapeau'), false);
 assert.equal(JSON.stringify(postBody).includes('Un titre'), false);
 assert.equal(JSON.stringify(postBody).includes('Ignorer les propriétés'), false);
 await main.evaluate(`globalThis.toSubstackFinishDraft()`);
 await poll(() => main.evaluate(`typeof globalThis.toSubstackFinishLanguages === 'function'`), 'Language processing started');
 assert.equal(await main.evaluate(`Boolean(document.querySelector('.modal a'))`), false, 'The draft link must wait until language processing finishes');
 assert.equal(await main.evaluate(`document.querySelector('.modal').textContent.includes('Brouillon «')`), false, 'Draft success must wait until language processing finishes');
 await main.evaluate(`globalThis.toSubstackFinishLanguages({ status: 200, json: { additional_post_languages_enabled: false } })`);
 await poll(() => main.evaluate(`document.querySelector('.modal a')?.getAttribute('href') === 'https://deuxieme-fixture.substack.com/publish/post/123'`), 'Created draft link');
 await main.call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
 await main.call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
 await poll(() => main.evaluate(`!document.querySelector('.modal')`), 'Draft dialog closed');
 await checkExportOptions();
 const fallbackPost = await main.evaluate(`(async () => {
  const file = await app.vault.create('Sans titre.md', 'Un paragraphe *partiellement* en italique.\\n\\nLa suite.');
  return globalThis.toSubstackPreparePost(app, file);
 })()`);
 assert.equal(fallbackPost.title, 'Sans titre');
 assert.equal(fallbackPost.subtitle, '');
 assert.equal(fallbackPost.body.content.length, 2);
 assert.equal(fallbackPost.body.content[0].content.map(node => node.text || '').join(''), 'Un paragraphe partiellement en italique.');
 const tableError = await main.evaluate(`(async () => {
  const file = await app.vault.create('Tableau.md', '| A | B |\\n| --- | --- |\\n| 1 | 2 |');
  try { await globalThis.toSubstackPreparePost(app, file); return ''; }
  catch (error) { return error.message; }
 })()`);
 assert.match(tableError, /tableaux/);
 const relativeImage = await main.evaluate(`(async () => {
  await app.vault.createFolder('notes');
  const file = await app.vault.create('notes/Image relative.md', '# Image relative\\n\\n![Image relative](../assets/pixel%20test.png)');
  return globalThis.toSubstackPreparePost(app, file);
 })()`);
 assert.equal(relativeImage.body.content[0].type, 'image2');
 assert.equal(relativeImage.body.content[0].attrs.src, `data:image/png;base64,${pixelBase64}`);
 const htmlImage = await main.evaluate(`(async () => {
  const file = await app.vault.create('Image HTML.md', '<img src="assets/pixel%20test.png" alt="Image HTML">');
  const post = await globalThis.toSubstackPreparePost(app, file);
  const image = new Image();
  image.src = post.body.content[0].attrs.src;
  await image.decode();
  return { post, width: image.naturalWidth, height: image.naturalHeight };
 })()`);
 assert.equal(htmlImage.post.body.content[0].attrs.src, `data:image/png;base64,${pixelBase64}`);
 assert.equal(htmlImage.post.body.content[0].attrs.alt, 'Image HTML');
 assert.equal(htmlImage.width, 1);
 assert.equal(htmlImage.height, 1);
 const missingImage = await main.evaluate(`(async () => {
  const file = await app.vault.create('Image manquante.md', '![[image inexistante.png]]');
  try { await globalThis.toSubstackPreparePost(app, file); return ''; }
  catch (error) { return error.message; }
 })()`);
 assert.match(missingImage, /introuvable/);
 assert.equal(await main.evaluate(`globalThis.toSubstackDrafts.length`), 1);
 const popoutPost = await main.evaluate(`(async () => {
  const { MarkdownPreviewRenderer } = globalThis.toSubstackUiCheck;
  const leaf = app.workspace.openPopoutLeaf();
  let processor;
  try {
   await leaf.openFile(app.vault.getFileByPath('Sans titre.md'));
   const paragraph = leaf.view.containerEl.doc.createElement('p');
   paragraph.appendText('Popout ');
   paragraph.createEl('strong', { text: 'content' });
   const differentWindow = !(paragraph instanceof HTMLElement);
   const file = await app.vault.create('Popout.md', 'Render the cross-window paragraph.');
   processor = app.plugins.getPlugin('to-substack').registerMarkdownPostProcessor((element, context) => {
    if (context.sourcePath === file.path) element.replaceChildren(paragraph);
   });
   return { differentWindow, post: await globalThis.toSubstackPreparePost(app, file) };
  } finally {
   if (processor) MarkdownPreviewRenderer.unregisterPostProcessor(processor);
   leaf.detach();
  }
 })()`);
 assert.equal(popoutPost.differentWindow, true, 'The paragraph must belong to a real popout window');
 assert.equal(popoutPost.post.body.content[0].content.map(node => node.text || '').join(''), 'Popout content');
 assert.ok(popoutPost.post.body.content[0].content.some(node => node.text === 'content' && node.marks.some(mark => mark.type === 'strong')));
 const englishSettings = await main.evaluate(`(() => {
  const ui = globalThis.toSubstackUiCheck;
  ui.setLocale('en');
  const plugin = app.plugins.getPlugin('to-substack');
  const definitions = new ui.SubstackSettingTab(app, plugin).getSettingDefinitions();
  new ui.PostModal(plugin, app.vault.getFileByPath('Test.md')).open();
  return { headings: definitions.map(group => group.heading), status: definitions[0].items[0].name };
 })()`);
 assert.deepEqual(englishSettings.headings, ['Substack account', 'Newsletters', 'Language editions', 'Export', 'Manual connection']);
 assert.equal(englishSettings.status, 'Connected to Compte de test');
 const englishCreate = await poll(() => main.evaluate(`(() => {
  const button = [...document.querySelectorAll('.modal button')].find(node => node.textContent === 'Create draft');
  if (!button) return null;
  const box = button.getBoundingClientRect(); return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
 })()`), 'English draft dialog');
 await main.evaluate(`globalThis.toSubstackImageFailure = true`);
 await main.call('Input.dispatchMouseEvent', { type: 'mousePressed', ...englishCreate, button: 'left', clickCount: 1 });
 await main.call('Input.dispatchMouseEvent', { type: 'mouseReleased', ...englishCreate, button: 'left', clickCount: 1 });
 await poll(() => main.evaluate(`Array.from(document.querySelectorAll('.modal [role="alert"]')).some(node => node.textContent === 'Could not upload an image to Substack. The draft was not created.')`), 'English image upload error');
 assert.equal(await main.evaluate(`globalThis.toSubstackDrafts.length`), 1, 'The English dialog must also stop before creating a partial draft');
 console.log(JSON.stringify({ status: 'PASS', localImageEncoding: true, imageUpload: true, relativeImages: true, htmlImages: true, noteDraft: true, internalSubstackNavigation: true, foreignNavigationBlocked: true, nativeSettings: true, nativeSecretControl: true, desktopSessionCapture: true, returnToMinimizedLogin: true, newsletterList: true, visibleErrorAndRetry: true, disconnect: true, beforeUnloadDismissed: true, spaLogin: true, automaticReturnWithoutBrowserEvent: true, hiddenSettingsRestored: true, pendingRequestCancellation: true, retryAfterCancellation: true, nativeWindowClose: true, otherTabsClickable: true, settingsClosable: true, loginSandbox: sandbox, authenticatedSubstackRequests: false }));
} catch (error) {
 console.error(error);
 if (pageList) for (const page of await pageList()) {
  const connection = await connect(page);
  console.error('PAGE', JSON.stringify({ url: page.url, info: await connection.evaluate(`({ text: document.body.textContent.slice(-2200), selects: [...document.querySelectorAll('select')].map(node => ({ html: node.outerHTML, display: getComputedStyle(node).display, active: node === document.activeElement })) })`).catch(() => null) }));
 }
 if (main) console.error('EXPLORER', JSON.stringify(await main.evaluate(`({ events: globalThis.toSubstackExplorerEvents, menuTitles: [...document.querySelectorAll('.menu-item-title')].map(node => node.textContent), modals: [...document.querySelectorAll('.modal')].map(node => node.textContent) })`).catch(() => null)));
 if (main) console.error('STATE', JSON.stringify(await main.evaluate(`(() => { const plugin = app.plugins.getPlugin('to-substack'); const electron = window.require('electron'); return { activity: plugin?.activity, error: plugin?.error, accountLoaded: !!plugin?.account, focusCalls: globalThis.toSubstackFocusCalls || 0, windows: (electron.remote ?? electron).BrowserWindow.getAllWindows().map(win => ({id: win.id, title: win.getTitle(), visible: win.isVisible(), minimized: win.isMinimized(), focused: win.isFocused()})) }; })()`)));
 console.error(stderr.slice(-1600));
 process.exitCode = 1;
} finally {
 if (main) { try { await main.evaluate(`app.plugins.getPlugin('to-substack')?.cancelConnection()`); } catch {} }
 for (const { socket } of sockets.values()) socket.close();
 child.kill();
 await Promise.race([closed, new Promise(resolve => setTimeout(resolve, 4000))]);
 if (child.exitCode === null) { child.kill('SIGKILL'); await closed; }
 await fs.rm(root, { recursive: true, force: true });
}
