import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startProxy } from '../src/proxy.mjs';

const secret = 'local-test-key';
const headers = { 'x-api-key': secret, 'content-type': 'application/json' };
const body = { model: 'GLM-5.3-Flash', max_tokens: 64,
  messages: [{ role: 'user', content: 'hi' }], stream: true };

test('authenticates discovery and inference and replaces client credentials on each upstream request', async () => {
  let reads = 0;
  const calls = [];
  const proxy = await startProxy({ secret, context: { cwd: '/test' },
    readAuth: async () => ({ token: `account-token-${++reads}` }),
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return new Response('event: message_stop\ndata: {"type":"message_stop"}\n\n', {
        headers: { 'content-type': 'text/event-stream' },
      });
    },
  });
  try {
    const denied = await fetch(proxy.url + '/v1/models');
    assert.equal(denied.status, 401);
    assert.equal(reads, 0);
    const discovery = await fetch(proxy.url + '/v1/models?limit=1000', { headers });
    assert.equal((await discovery.json()).data.length, 2);
    for (let count = 0; count < 2; count++) {
      const response = await fetch(proxy.url + '/v1/messages', {
        method: 'POST', headers: { ...headers, 'anthropic-beta': 'untrusted-beta', 'x-client-sig': 'untrusted-signature' },
        body: JSON.stringify(body),
      });
      assert.match(await response.text(), /message_stop/);
    }
    assert.equal(reads, 2);
    assert.ok(calls.every(call => call.url === 'https://zcode.z.ai/api/v1/zcode-plan/anthropic/v1/messages'));
    assert.equal(calls[1].options.headers.authorization, 'Bearer account-token-2');
    assert.equal(calls[0].options.headers['anthropic-beta'], undefined);
    assert.equal(calls[0].options.headers['x-client-sig'], undefined);
    const unknown = await fetch(proxy.url + '/v1/messages', {
      method: 'POST', headers, body: JSON.stringify({ ...body, model: 'unapproved-model' }),
    });
    assert.equal(unknown.status, 400);
    assert.equal(calls.length, 2);
  } finally { await proxy.close(); }
  await assert.rejects(fetch(proxy.url + '/v1/models', { headers }));
});

test('streams immediately and cancels the upstream when the client disconnects', async () => {
  let signal;
  let abortObserved;
  const aborted = new Promise(resolve => { abortObserved = resolve; });
  const proxy = await startProxy({ secret, context: { cwd: '/test' },
    readAuth: async () => ({ token: 'test-account-token' }),
    fetchImpl: async (url, options) => {
      signal = options.signal;
      return new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('event: ping\ndata: {}\n\n'));
          signal.addEventListener('abort', abortObserved, { once: true });
        },
      }), { headers: { 'content-type': 'text/event-stream' } });
    },
  });
  try {
    const controller = new AbortController();
    const response = await fetch(proxy.url + '/v1/messages', {
      method: 'POST', headers, body: JSON.stringify(body), signal: controller.signal,
    });
    const chunk = await response.body.getReader().read();
    assert.match(new TextDecoder().decode(chunk.value), /event: ping/);
    assert.equal(signal.aborted, false);
    controller.abort();
    await Promise.race([aborted, new Promise((_, reject) => {
      const timer = setTimeout(() => reject(new Error('Upstream was not canceled')), 1500);
      timer.unref();
    })]);
    assert.equal(signal.aborted, true);
  } finally { await proxy.close(); }
});

test('reports a business error instead of returning an empty successful response', async () => {
  const proxy = await startProxy({ secret, context: { cwd: '/test' },
    readAuth: async () => ({ token: 'test-token' }),
    fetchImpl: async () => Response.json({ code: 1005, msg: 'expired' }),
  });
  try {
    const response = await fetch(proxy.url + '/v1/messages', { method: 'POST', headers, body: JSON.stringify(body) });
    assert.equal(response.status, 502);
    assert.match((await response.json()).error.message, /expired/);
  } finally { await proxy.close(); }
});
