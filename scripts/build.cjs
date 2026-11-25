const esbuild = require('esbuild');
const { builtinModules } = require('node:module');
const { resolve } = require('node:path');

function buildOptions(mode) {
	const prod = mode === 'production';
	return {
		entryPoints: ['plugin/main.ts'],
		plugins: mode === 'private' ? [{ name: 'local-development', setup(build) {
			build.onResolve({ filter: /^@tcrouzet\/obsidian-toolbox\// }, args => ({ path: resolve(require('node:os').homedir(), 'Documents/python/obsidian-toolbox/src', args.path.slice('@tcrouzet/obsidian-toolbox/'.length) + '.ts') }));
			build.onResolve({ filter: /^\.\/development$/ }, args => args.importer === resolve('plugin/main.ts') ? { path: resolve('private/index.ts') } : undefined);
		} }] : [],
		bundle: true,
		supported: mode === 'private' ? { 'dynamic-import': false } : undefined,
		loader: { '.svg': 'text' },
		external: [
			'obsidian',
			'node:*',
			'electron',
			'@codemirror/autocomplete',
			'@codemirror/collab',
			'@codemirror/commands',
			'@codemirror/language',
			'@codemirror/lint',
			'@codemirror/search',
			'@codemirror/state',
			'@codemirror/view',
			'@lezer/common',
			'@lezer/highlight',
			'@lezer/lr',
			...builtinModules
		],
		format: 'cjs',
		target: 'es2018',
		logLevel: 'info',
		sourcemap: prod ? false : 'inline',
		treeShaking: true,
		outfile: 'main.js'
	};
}

async function build(mode) {
	const context = await esbuild.context(buildOptions(mode));
	if (mode === 'production' || mode === 'private') {
		await context.rebuild();
		await context.dispose();
	} else {
		await context.watch();
	}
}

module.exports = { buildOptions };

if (require.main === module) build(process.argv[2]).catch(error => {
	console.error(error);
	process.exitCode = 1;
});
