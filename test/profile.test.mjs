import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ensureProfile } from '../src/profile.mjs';
import { extractSettings } from '../src/launcher.mjs';

test('keeps model preferences and login state separate while sharing instruction definitions', async () => {
  const home = await mkdtemp(join(tmpdir(), 'glm-profile-test-'));
  try {
    const original = join(home, '.claude');
    await mkdir(original);
    await writeFile(join(original, 'settings.json'), '{"model":"opus","hooks":{"SessionStart":[]}}');
    await writeFile(join(original, 'CLAUDE.md'), 'User instructions');
    await writeFile(join(original, '.credentials.json'), 'private-test-credential');
    const profile = await ensureProfile({ home });
    assert.equal(await readlink(join(profile, 'CLAUDE.md')), join(original, 'CLAUDE.md'));
    await writeFile(join(profile, 'settings.json'), '{"model":"GLM-5.3"}');
    await ensureProfile({ home });
    assert.match(await readFile(join(profile, 'settings.json'), 'utf8'), /GLM-5.3/);
    assert.equal(JSON.parse(await readFile(join(original, 'settings.json'), 'utf8')).model, 'opus');
    await assert.rejects(readFile(join(profile, '.credentials.json')), { code: 'ENOENT' });
  } finally { await rm(home, { recursive: true, force: true }); }
});

test('combines extra settings into one argument so routing settings cannot be dropped by a later flag', async () => {
  const result = await extractSettings(['-p', 'hello', '--settings', '{"disableAllHooks":true}',
    '--settings={"env":{"TEST":"value"}}']);
  assert.deepEqual(result.args, ['-p', 'hello']);
  assert.equal(result.settings.disableAllHooks, true);
  assert.equal(result.settings.env.TEST, 'value');
  await assert.rejects(extractSettings(['--settings']), /requires JSON/);
});
