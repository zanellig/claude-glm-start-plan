import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('source CLI receives only a local key and uses its own session database and storage', async () => {
  const root = await mkdtemp(join(tmpdir(), 'zcode-launch-test-'));
  let child;
  try {
    const credentials = join(root, '.zcode/v2');
    const dist = join(root, 'runtime/apps/zcode-cli/packages/cli/dist');
    const cwd = join(root, 'project');
    await mkdir(credentials, { recursive: true });
    await mkdir(dist, { recursive: true });
    await mkdir(cwd);
    await writeFile(join(credentials, 'credentials.json'), JSON.stringify({
      zcodejwttoken: 'test-real-jwt', 'oauth:active_provider': 'zai',
    }));
    await writeFile(join(dist, 'zcode.cjs'), `
const fs=require('node:fs/promises');
(async()=>{
 const path=process.env.ZCODE_PERSONAL_PROVIDER_CONFIG_FILE;
 const p=JSON.parse(await fs.readFile(path,'utf8')).config;
 const provider=p.providerConfigRules.providerRules[0];
 const r=await fetch(provider.config.api.baseUrl+'/v1/models',{headers:{'x-api-key':provider.config.access.apiKey}});
 console.log(JSON.stringify({path,mode:(await fs.stat(path)).mode&0o777,
  usesLocalKey:provider.config.access.apiKey!=='test-real-jwt',
  defaultModel:p.defaultModelSelection,models:(await r.json()).data.map(x=>x.id),
  cwd:process.cwd(),storage:process.env.ZCODE_STORAGE_DIR,db:process.env.ZCODE_SESSION_DB_PATH,
  logs:process.env.ZCODE_LOG_DIR,url:provider.config.api.baseUrl}));
})().catch(()=>process.exit(1));`);
    child = spawn(process.execPath, [fileURLToPath(new URL('../bin/zcode.mjs', import.meta.url)), '--cwd', cwd], {
      env: { ...process.env, ZCODE_DATA_BASE_DIR: root, ZCODE_START_RUNTIME: join(root, 'runtime'),
        ZCODE_START_NODE: process.execPath, ZCODE_START_DATA_DIR: join(root, 'data') },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    const code = await new Promise(resolve => child.once('close', resolve));
    assert.equal(code, 0, stderr);
    const result = JSON.parse(stdout);
    assert.deepEqual(result.defaultModel, { providerId: 'zcode-start', modelId: 'GLM-5.3-Flash' });
    assert.deepEqual(result.models, ['GLM-5.3-Flash', 'GLM-5.3']);
    assert.equal(result.usesLocalKey, true);
    assert.equal(result.mode, 0o600);
    assert.equal(result.cwd, cwd);
    assert.equal(result.storage, join(root, 'data/.zcode'));
    assert.equal(result.db, join(root, 'data/.zcode/cli/db/db.sqlite'));
    assert.equal(result.logs, join(root, 'data/.zcode/cli/log'));
    await assert.rejects(access(result.path), { code: 'ENOENT' });
    await assert.rejects(fetch(result.url + '/v1/models'));
  } finally {
    child?.kill('SIGKILL');
    await rm(root, { recursive: true, force: true });
  }
});
