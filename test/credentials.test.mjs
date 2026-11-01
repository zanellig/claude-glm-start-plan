import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCipheriv, createHash, randomBytes } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCredentialReader, decryptCredential } from '../src/credentials.mjs';

function encrypt(text, secret) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', createHash('sha256').update(secret).digest(), iv);
  const content = Buffer.concat([cipher.update(text), cipher.final()]);
  return 'enc:v1:' + [iv, cipher.getAuthTag(), content].map(part => part.toString('base64url')).join('.');
}

test('reads the authenticated store again after the desktop rotates a login', async () => {
  const home = await mkdtemp(join(tmpdir(), 'glm-auth-test-'));
  try {
    const root = join(home, '.zcode/v2');
    await mkdir(root, { recursive: true });
    const secret = 'test-secret';
    const save = token => writeFile(join(root, 'credentials.json'), JSON.stringify({
      zcodejwttoken: encrypt(token, secret),
      'oauth:active_provider': encrypt('zai', secret),
    }));
    await save('first-test-token');
    await writeFile(join(root, 'telemetry-state.json'), JSON.stringify({ deviceMid: 'test-device' }));
    const read = createCredentialReader({ home, env: { ZCODE_CREDENTIAL_SECRET: secret } });
    assert.deepEqual(await read(), { token: 'first-test-token', deviceMid: 'test-device' });
    await save('rotated-test-token');
    assert.equal((await read()).token, 'rotated-test-token');
    await writeFile(join(root, 'credentials.json'), JSON.stringify({
      zcodejwttoken: encrypt('other-account', secret), 'oauth:active_provider': encrypt('bigmodel', secret),
    }));
    await assert.rejects(read, /Select your Z.ai account/);
  } finally { await rm(home, { recursive: true, force: true }); }
});

test('rejects corrupted or mismatched ciphertext without exposing credential material', () => {
  assert.throws(() => decryptCredential(encrypt('private-test-token', 'right'), 'wrong'), /Cannot read/);
  assert.throws(() => decryptCredential('enc:v1:bad.bad.bad', 'secret'), /Unsupported/);
});
