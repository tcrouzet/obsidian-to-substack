const assert = require('node:assert/strict');
const { readFileSync, readdirSync } = require('node:fs');
const { runInNewContext } = require('node:vm');
const { buildSync } = require('esbuild');
const ts = require('typescript');
const en = require('../locales/en.json');
const fr = require('../locales/fr.json');

const placeholders = value => [...new Set(value.match(/\{\w+\}/g) || [])].sort();
assert.deepEqual(Object.keys(fr).sort(), Object.keys(en).sort());
for (const key of Object.keys(en)) {
	assert.match(key, /^[a-z][A-Za-z0-9]*$/);
	assert.ok(en[key].trim() && fr[key].trim(), `Empty translation: ${key}`);
	assert.deepEqual(placeholders(en[key]), placeholders(fr[key]), `Translation parameters: ${key}`);
}

const translationModule = { exports: {} };
runInNewContext(buildSync({ entryPoints: ['plugin/i18n.ts'], bundle: true, write: false, format: 'cjs' }).outputFiles[0].text, { module: translationModule, exports: translationModule.exports });
const { resolveLocale, getLocale, setLocale, t } = translationModule.exports;
assert.equal(getLocale(), 'en');
for (const language of ['en', 'en-GB', 'de-DE', '', '__proto__']) assert.equal(resolveLocale(language), 'en');
for (const language of ['fr', 'fr-CA', 'FR_fr']) assert.equal(resolveLocale(language), 'fr');
for (const [language, catalog] of [['en', en], ['fr', fr]]) {
	setLocale(language);
	for (const key of Object.keys(catalog)) {
		const values = Object.fromEntries(placeholders(catalog[key]).map(value => [value.slice(1, -1), 'SENTINEL']));
		assert.equal(t(key, values), catalog[key].replace(/\{\w+\}/g, 'SENTINEL'));
	}
}
setLocale('en');
assert.equal(t('imageNotFound', { file: 'Été {image}.png' }), 'Image not found in the vault: Été {image}.png');
assert.throws(() => t('draftCreated'), /Missing translation parameter: title/);
assert.equal(t('signIn', {}, 'fr'), 'Se connecter');

for (const filename of readdirSync('plugin').filter(name => name.endsWith('.ts'))) {
	const source = ts.createSourceFile(filename, readFileSync(`plugin/${filename}`, 'utf8'), ts.ScriptTarget.Latest, true);
	function visit(node) {
		if (ts.isStringLiteralLike(node)) assert.doesNotMatch(node.text, /[àâçéèêëîïôùûüœ]/i, `Untranslated French text in ${filename}`);
		if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 't' && ts.isStringLiteralLike(node.arguments[0])) {
			assert.ok(Object.hasOwn(en, node.arguments[0].text), `Unknown translation in ${filename}`);
		}
		if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && ['setButtonText', 'setName', 'setTitle', 'setText'].includes(node.expression.name.text) && node.arguments[0]) {
			assert.ok(!ts.isStringLiteralLike(node.arguments[0]), `Hardcoded UI label in ${filename}`);
		}
		ts.forEachChild(node, visit);
	}
	visit(source);
}
console.log(`Localization: ${Object.keys(en).length} English/French messages, placeholders, language fallback and UI labels pass.`);
