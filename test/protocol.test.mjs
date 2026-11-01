import { test } from 'node:test';
import assert from 'node:assert/strict';
import { transformRequest, resolveEffort, upstreamError } from '../src/protocol.mjs';

const context = { cwd: '/test/work', isGit: true, shell: '/bin/zsh' };
function request() {
  return {
    model: 'GLM-5.3-Flash', max_tokens: 64000,
    system: [{ type: 'text', text: 'Claude instructions', cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: 'Read the file' }],
    tools: [{ name: 'Read', input_schema: { type: 'object' } }],
    thinking: { type: 'adaptive' }, output_config: { effort: 'max' }, stream: true,
  };
}

test('preserves Claude instructions as a system turn, tool schemas, and input immutability', () => {
  const input = request();
  const original = structuredClone(input);
  const body = transformRequest(input, context);
  assert.deepEqual(input, original);
  assert.equal(body.model, 'GLM-5.3-Flash');
  assert.equal(body.system.length, 3);
  assert.match(body.system[0].text, /You are ZCode/);
  assert.ok(body.system.every(block => !block.text.includes('Claude instructions')));
  assert.deepEqual(body.messages, [
    { role: 'system', content: 'Claude instructions' }, ...input.messages,
  ]);
  assert.deepEqual(body.tools, input.tools);
  assert.deepEqual(body.thinking, { type: 'enabled' });
  assert.equal(body.output_config.effort, 'max');
  assert.match(body.system[2].text, /Primary working directory: \/test\/work/);
});

test('maps all Claude effort values to the actual supported GLM values', () => {
  for (const [input, expected] of Object.entries({ low: 'low', medium: 'high', high: 'high', xhigh: 'max', max: 'max' })) {
    assert.equal(resolveEffort(input), expected);
    const body = transformRequest({ ...request(), output_config: { effort: input } }, context);
    assert.equal(body.output_config.effort, expected);
  }
  assert.equal(resolveEffort(undefined), 'high');
  assert.equal(resolveEffort('high', { type: 'disabled' }), 'low');
  assert.throws(() => resolveEffort('ultra'), /Supported effort/);
});

test('uses the latest per-turn effort and removes empty unsupported system updates', () => {
  const body = transformRequest({ ...request(), messages: [
    { role: 'user', content: 'first' },
    { role: 'system', content: [], output_config: { effort: 'xhigh' } },
    { role: 'system', content: [{ type: 'text', text: 'reminder' }] },
  ] }, context);
  assert.equal(body.output_config.effort, 'max');
  assert.deepEqual(body.messages.at(-1), { role: 'system', content: 'reminder' });
  assert.ok(body.messages.every(message => message.output_config === undefined));
  assert.equal(body.messages.length, 3);
});

test('keeps tool results and reasoning history unchanged across a tool round trip', () => {
  const history = [
    { role: 'user', content: 'read' },
    { role: 'assistant', content: [
      { type: 'thinking', thinking: 'read it', signature: '' },
      { type: 'tool_use', id: 'call1', name: 'Read', input: { path: 'x' } },
    ] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'call1', content: 'file contents' }] },
  ];
  const body = transformRequest({ ...request(), messages: history }, context);
  assert.deepEqual(body.messages.slice(1), history);
});

test('does not route unknown models or malformed inputs to paid endpoints', () => {
  assert.throws(() => transformRequest({ ...request(), model: 'claude-opus-5-5' }, context), /Select GLM/);
  assert.throws(() => transformRequest({}, context), /Expected an Anthropic/);
  assert.equal(transformRequest({ ...request(), model: 'GLM-5.3' }, context).model, 'GLM-5.3');
  assert.equal(transformRequest({ ...request(), max_tokens: 1000000 }, context).max_tokens, 128000);
});

test('turns business-code failures inside HTTP 200 into actual API errors', () => {
  const failure = upstreamError(200, { code: 1005, msg: 'expired' });
  assert.equal(failure.status, 502);
  assert.match(failure.body.error.message, /allowance/);
  const blocked = upstreamError(405, { code: 3012, msg: 'arbitrary internal text' });
  assert.equal(blocked.status, 405);
  assert.ok(!blocked.body.error.message.includes('arbitrary internal text'));
});
