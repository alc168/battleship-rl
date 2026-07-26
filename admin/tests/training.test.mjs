import { test, expect } from '../lib/harness.mjs';

// The worker expects a global `self` object. In Node, alias globalThis to self.
globalThis.self = globalThis;
const messages = [];
globalThis.postMessage = (msg) => messages.push(msg);

await import('../../web/src/training.worker.js');

test('training worker completes a 500-game batch and returns a delta', async () => {
  messages.length = 0;
  await globalThis.onmessage({ data: { weightMap: {}, placementMemory: [] } });

  const complete = messages.find(m => m.type === 'complete');
  expect(complete).toBeDefined();
  expect(complete.completed).toBe(500);
  expect(complete.elapsed).toBeGreaterThan(0);
  expect(typeof complete.delta).toBe('object');

  const progress = messages.filter(m => m.type === 'progress');
  expect(progress.length).toBeGreaterThan(0);
}, { component: 'Training worker', control: 'CC7.2' });
