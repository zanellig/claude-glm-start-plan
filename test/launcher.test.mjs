import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const entry = fileURLToPath(new URL('../bin/claude-glm.mjs', import.meta.url));

async function fixture(wait) {
  const root = await mkdtemp(join(tmpdir(), 'glm-launch-test-'));
  await mkdir(join(root, '.zcode/v2'), { recursive: true });
  await writeFile(join(root, '.zcode/v2/credentials.json'), JSON.stringify({
    zcodejwttoken: 'test-jwt-only', 'oauth:active_provider': 'zai',
  }));
  const fake = join(root, 'fake-claude.mjs');
  await writeFile(fake, `#!/usr/bin/env node
import {readFile,stat} from 'node:fs/promises';
const settingsFile=process.argv[process.argv.indexOf('--settings')+1];
const settings=JSON.parse(await readFile(settingsFile,'utf8'));
const r=await fetch(process.env.ANTHROPIC_BASE_URL+'/v1/models',{headers:{authorization:'Bearer '+process.env.ANTHROPIC_AUTH_TOKEN}});
console.log(JSON.stringify({url:process.env.ANTHROPIC_BASE_URL,settingsFile,mode:(await stat(settingsFile)).mode&0o777,models:(await r.json()).data.map(x=>x.id),picker:settings.modelPicker.options.map(x=>x.model),pid:process.pid}));
${wait ? 'setInterval(()=>{},1000);' : ''}
`, { mode: 0o700 });
  const child = spawn(process.execPath, [entry], { cwd: root, env: {
    ...process.env, ZCODE_DATA_BASE_DIR: root, CLAUDE_GLM_PROFILE: join(root, 'profile'),
    CLAUDE_GLM_CLAUDE: fake,
  }, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  const closed = new Promise(resolve => child.once('close', code => resolve({ code, stdout, stderr })));
  return { child, root, closed, async ready() {
    for (let attempts = 0; attempts < 100; attempts++) {
      if (stdout.includes('\n')) return JSON.parse(stdout.trim().split('\n')[0]);
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    throw new Error('Fake CLI did not start: ' + stderr);
  } };
}

test('cleans the authenticated listener and private settings file after Claude exits', async () => {
  const run = await fixture(false);
  try {
    const result = await run.closed;
    assert.equal(result.code, 0, result.stderr);
    const state = JSON.parse(result.stdout);
    assert.deepEqual(state.models, ['GLM-5.3-Flash', 'GLM-5.3']);
    assert.deepEqual(state.picker, state.models);
    assert.equal(state.mode, 0o600);
    await assert.rejects(access(state.settingsFile), { code: 'ENOENT' });
    await assert.rejects(fetch(state.url + '/v1/models'));
    assert.ok(!result.stdout.includes('test-jwt-only'));
  } finally {
    run.child.kill('SIGKILL');
    await rm(run.root, { recursive: true, force: true });
  }
});

test('terminates Claude and removes the listener and settings file on SIGTERM', async () => {
  const run = await fixture(true);
  try {
    const state = await run.ready();
    run.child.kill('SIGTERM');
    await run.closed;
    await assert.rejects(access(state.settingsFile), { code: 'ENOENT' });
    await assert.rejects(fetch(state.url + '/v1/models'));
    assert.throws(() => process.kill(state.pid, 0), { code: 'ESRCH' });
  } finally {
    run.child.kill('SIGKILL');
    await rm(run.root, { recursive: true, force: true });
  }
});
