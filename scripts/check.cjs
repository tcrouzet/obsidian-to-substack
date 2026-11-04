const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { runInNewContext } = require('node:vm');
const { buildSync } = require('esbuild');
const { Linter } = require('eslint');
const ts = require('typescript');

const config = ts.readConfigFile('tsconfig.json', ts.sys.readFile);
assert.equal(config.error, undefined);
const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, process.cwd());
const program = ts.createProgram(parsed.fileNames, { ...parsed.options, types: [], skipLibCheck: true, noEmit: true });
const linter = new Linter();
linter.defineParser('@typescript-eslint/parser', require('@typescript-eslint/parser'));
const rules = require('@typescript-eslint/eslint-plugin').rules;
const ruleNames = ['no-this-alias', 'no-explicit-any', 'no-unused-vars', 'no-unsafe-assignment', 'no-floating-promises', 'no-unsafe-call', 'no-unsafe-argument', 'no-unsafe-return', 'no-misused-promises'];
for (const name of ruleNames) linter.defineRule('@typescript-eslint/' + name, rules[name]);
for (const file of parsed.fileNames) {
	assert.deepEqual(linter.verify(readFileSync(file, 'utf8'), {
		parser: '@typescript-eslint/parser',
		parserOptions: { ecmaVersion: 2020, sourceType: 'module', programs: [program], tsconfigRootDir: process.cwd() },
		rules: Object.fromEntries(ruleNames.map(name => ['@typescript-eslint/' + name, 'error']))
	}, file), []);
}

const manifest = JSON.parse(readFileSync('manifest.json', 'utf8'));
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
const versions = JSON.parse(readFileSync('versions.json', 'utf8'));
assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
assert.equal(pkg.version, manifest.version);
assert.equal(lock.version, manifest.version);
assert.equal(lock.packages[''].version, manifest.version);
assert.equal(versions[manifest.version], manifest.minAppVersion);

class Plugin {}
const pluginModule = { exports: {} };
runInNewContext(buildSync({
	entryPoints: ['plugin/main.ts'], bundle: true, write: false, format: 'cjs', external: ['obsidian']
}).outputFiles[0].text, {
	module: pluginModule,
	exports: pluginModule.exports,
	require: name => {
		assert.equal(name, 'obsidian');
		return { Plugin };
	}
});
assert.ok(new pluginModule.exports.default() instanceof Plugin);
console.log('Source lint, version consistency and plugin export: pass.');

require('./check-release.cjs');
