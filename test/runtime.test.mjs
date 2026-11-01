import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolveClaudeRuntime, resolveZcodeRuntime } from '../src/runtime.mjs';

async function machine(t) {
  const root = await mkdtemp(join(tmpdir(), 'glm-portable-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const tools = join(root, 'tools with spaces');
  await mkdir(tools);
  async function command(name, version) {
    const path = join(tools, name);
    await writeFile(path, `#!${process.execPath}
if(process.argv.includes('--version')){console.log(${JSON.stringify(version)});process.exit(0);}
console.log('Fresh machine help');`, { mode: 0o700 });
    return path;
  }
  const claude = await command('claude', '2.1.242 (Claude Code)');
  const node26 = await command('wrong-node', 'v26.12.1');
  const node24 = join(tools, 'node24');
  await writeFile(node24, `#!${process.execPath}
if(process.argv.includes('--version')){console.log('v24.22.1');process.exit(0);}
const {spawnSync}=require('node:child_process');
process.exit(spawnSync(process.execPath,process.argv.slice(2),{stdio:'inherit'}).status??1);`, { mode: 0o700 });
  const env = {
    PATH: tools, XDG_CONFIG_HOME: join(root, 'config'), XDG_DATA_HOME: join(root, 'data'),
  };
  return { root, tools, command, claude, node24, node26, env,
    context: { env, home: join(root, 'different user'), cwd: root, execPath: node26 } };
}

async function builtRuntime(root) {
  const runtime = join(root, 'custom build');
  const dist = join(runtime, 'apps/zcode-cli/packages/cli/dist');
  await mkdir(join(dist, 'provider'), { recursive: true });
  await writeFile(join(dist, 'zcode.cjs'), "console.log('0.17.1');");
  await writeFile(join(dist, 'provider/zcode-builtin.json'), '{}');
  return runtime;
}

test('discovers Claude on a synthetic PATH and derives paths from that user configuration', async t => {
  const m = await machine(t);
  const found = await resolveClaudeRuntime(m.context);
  assert.equal(found.command, m.claude);
  assert.equal(found.profile, join(m.env.XDG_CONFIG_HOME, 'claude-glm/claude'));
  assert.equal(found.sourceProfile, join(m.context.home, '.claude'));
});

test('honors executable/profile overrides and a custom ordinary Claude profile', async t => {
  const m = await machine(t);
  const explicit = await m.command('chosen claude', '2.2.0 (Claude Code)');
  const result = await resolveClaudeRuntime({ ...m.context, env: { ...m.env,
    CLAUDE_GLM_CLAUDE: explicit, CLAUDE_GLM_PROFILE: '~/my-profile', CLAUDE_CONFIG_DIR: './ordinary-profile',
  } });
  assert.equal(result.command, explicit);
  assert.equal(result.profile, join(m.context.home, 'my-profile'));
  assert.equal(result.sourceProfile, join(m.root, 'ordinary-profile'));
});

test('reports missing and old Claude installations before creating session resources', async t => {
  const m = await machine(t);
  await assert.rejects(resolveClaudeRuntime({ ...m.context, env: { PATH: '' } }), /not found on PATH/);
  const old = await m.command('old-claude', '2.1.100 (Claude Code)');
  await assert.rejects(resolveClaudeRuntime({ ...m.context, env: { ...m.env, CLAUDE_GLM_CLAUDE: old } }), /2\.1\.242 or newer/);
  await assert.rejects(resolveClaudeRuntime({ ...m.context, env: { ...m.env, CLAUDE_GLM_CLAUDE: './missing' } }), /CLAUDE_GLM_CLAUDE does not identify/);
});

test('selects a compatible Node from PATH instead of assuming an NVM installation', async t => {
  const m = await machine(t);
  const runtime = await builtRuntime(m.root);
  const result = await resolveZcodeRuntime({ ...m.context, env: { ...m.env, ZCODE_START_RUNTIME: runtime } });
  assert.equal(result.node, m.node24);
  assert.equal(result.cli, join(runtime, 'apps/zcode-cli/packages/cli/dist/zcode.cjs'));
  assert.equal(result.base, join(m.env.XDG_DATA_HOME, 'zcode-start'));
});

test('uses a compatible current Node without needing a second installation on PATH', async t => {
  const m = await machine(t);
  const runtime = await builtRuntime(m.root);
  const result = await resolveZcodeRuntime({ ...m.context, execPath: m.node24,
    env: { PATH: '', ZCODE_START_RUNTIME: runtime, ZCODE_START_DATA_DIR: './cli-state' } });
  assert.equal(result.node, m.node24);
  assert.equal(result.base, join(m.root, 'cli-state'));
});

test('does not silently replace an explicit incompatible Node or invent a missing runtime', async t => {
  const m = await machine(t);
  await assert.rejects(resolveZcodeRuntime({ ...m.context,
    env: { ...m.env, ZCODE_START_NODE: m.node26 } }), /must select a Node 24/);
  await assert.rejects(resolveZcodeRuntime({ ...m.context, env: { PATH: '' } }), /Node 24 was not found/);
  await assert.rejects(resolveZcodeRuntime(m.context), /built ZCode runtime was not found/);
});

test('fresh-checkout informational commands work without credentials, profiles, or local installation links', async t => {
  const m = await machine(t);
  const runtime = await builtRuntime(m.root);
  const env = { ...m.env, CLAUDE_GLM_CLAUDE: '', ZCODE_START_NODE: '',
    ZCODE_START_RUNTIME: runtime, ZCODE_DATA_BASE_DIR: join(m.root, 'no-login') };
  for (const [client, argument, expected] of [
    ['claude-glm', '--help', 'Fresh machine help'], ['zcode', 'version', '0.17.1'],
  ]) {
    const entry = fileURLToPath(new URL(`../bin/${client}.mjs`, import.meta.url));
    const result = spawnSync(process.execPath, [entry, argument], { cwd: m.root, env, encoding: 'utf8', timeout: 5000 });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, new RegExp(expected));
  }
  await assert.rejects(access(join(m.env.XDG_CONFIG_HOME, 'claude-glm/claude')), { code: 'ENOENT' });
  await assert.rejects(access(join(m.root, 'no-login/.zcode')), { code: 'ENOENT' });
});
