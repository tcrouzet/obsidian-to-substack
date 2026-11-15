const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

const fixture = mkdtempSync(join(tmpdir(), 'to-substack-release-'));
const repo = join(fixture, 'plugin with spaces');
const remote = join(fixture, 'remote.git');
const bin = join(fixture, 'bin');
const npmCli = process.env.npm_execpath;
assert.ok(npmCli, 'Run this check through npm run lint');

function git(...args) {
	return execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

try {
	mkdirSync(repo);
	mkdirSync(bin);
	git('init', '--bare', remote);
	git('init', '--initial-branch=main');
	git('config', 'user.email', 'test@example.invalid');
	git('config', 'user.name', 'Release test');
	git('config', 'commit.gpgsign', 'false');
	git('config', 'tag.gpgsign', 'false');
	git('remote', 'add', 'origin', remote);
	copyFileSync('release.sh', join(repo, 'release.sh'));
	for (const file of ['manifest.json', 'versions.json']) copyFileSync(file, join(repo, file));
	const version = JSON.parse(readFileSync('manifest.json', 'utf8')).version;
	writeFileSync(join(repo, 'package.json'), JSON.stringify({ name: 'release-fixture', version }));
	writeFileSync(join(repo, 'package-lock.json'), JSON.stringify({
		name: 'release-fixture', version, lockfileVersion: 3, packages: { '': { name: 'release-fixture', version } }
	}));
	writeFileSync(join(bin, 'gh'), `#!${process.execPath}
const fs = require('node:fs');
if (process.argv[2] === 'repo') console.log(JSON.stringify({ nameWithOwner: 'test/to-substack', defaultBranchRef: { name: 'main' } }));
else if (process.argv[2] === 'api') console.log(fs.readFileSync('manifest.json', 'utf8'));
else process.exit(1);
`, { mode: 0o755 });
	writeFileSync(join(bin, 'npm'), `#!${process.execPath}
const { spawnSync } = require('node:child_process');
const args = process.argv.slice(2);
if (args[0] === 'version') process.exit(spawnSync(${JSON.stringify(process.execPath)}, [${JSON.stringify(npmCli)}, ...args], { stdio: 'inherit' }).status ?? 1);
if (args[0] !== 'ci' && args[0] !== 'run') process.exit(1);
`, { mode: 0o755 });
	git('add', '.');
	git('commit', '-m', 'Initial fixture');

	function release() {
		return spawnSync('bash', [join(repo, 'release.sh')], {
			cwd: fixture,
			env: { ...process.env, PATH: bin + ':' + process.env.PATH, GIT_TERMINAL_PROMPT: '0' },
			encoding: 'utf8'
		});
	}

	const nextVersion = version.replace(/\d+$/, patch => String(Number(patch) + 1));
	for (const expected of [version, nextVersion]) {
		const result = release();
		assert.equal(result.status, 0, result.stdout + result.stderr);
		assert.equal(git('tag', '--points-at', 'HEAD'), expected);
		assert.equal(JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8')).version, expected);
		assert.equal(JSON.parse(readFileSync(join(repo, 'manifest.json'), 'utf8')).version, expected);
		assert.ok(git('ls-remote', '--tags', 'origin', 'refs/tags/' + expected).endsWith('refs/tags/' + expected));
		assert.equal(git('status', '--porcelain'), '');
	}
	git('switch', '-c', 'feature');
	const refused = release();
	assert.notEqual(refused.status, 0);
	assert.match(refused.stderr, /branche par défaut/);
	assert.deepEqual(git('tag', '--list').split('\n').sort(), [version, nextVersion].sort());
	console.log('Release flow: initial tag, patch bump and branch refusal pass in a disposable local repository.');
} finally {
	rmSync(fixture, { recursive: true, force: true });
}
