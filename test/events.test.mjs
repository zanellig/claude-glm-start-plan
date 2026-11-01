import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeEvents } from '../src/events.mjs';

async function normalize(chunks) {
  return new Response(new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  }).pipeThrough(normalizeEvents())).text();
}

test('preserves fragmented UTF-8, JSON deltas, and CRLF SSE frames', async () => {
  const text = 'event: content_block_delta\r\ndata: {"delta":{"text":"¡Hola!"}}\r\n\r\n';
  const bytes = new TextEncoder().encode(text);
  const chunks = Array.from(bytes, byte => new Uint8Array([byte]));
  assert.equal(await normalize(chunks), text);
});

test('reports a business failure inside a successful stream as an actual error event', async () => {
  const bytes = new TextEncoder().encode('data: {"code":1005,"msg":"expired"}\n\nevent: message_stop\ndata: {}\n\n');
  const output = await normalize([bytes]);
  assert.match(output, /event: error/);
  assert.match(output, /allowance/);
  assert.ok(!output.includes('message_stop'));
});
