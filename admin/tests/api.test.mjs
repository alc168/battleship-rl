import { test, test as harnessTest, expect, getEnv } from '../lib/harness.mjs';

const API_BASE_URL = getEnv('API_BASE_URL', 'https://battleship-rl-api.battleship-rl.workers.dev');
const API_KEY = getEnv('API_KEY', '');

const json = (path, opts = {}) => fetch(`${API_BASE_URL}${path}`, opts).then(r => r.json());
const status = (path, opts = {}) => fetch(`${API_BASE_URL}${path}`, opts).then(r => r.status);

const commonHeaders = API_KEY ? { 'X-API-Key': API_KEY } : {};

function authTest(name, fn, options) {
  if (!API_KEY) {
    harnessTest.skip(name, () => {}, options);
    return;
  }
  harnessTest(name, fn, options);
}

test('GET /api/weight-map returns 200 and a JSON object', async () => {
  const res = await fetch(`${API_BASE_URL}/api/weight-map`);
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(typeof body).toBe('object');
}, { component: 'Worker API', control: 'A1.2' });

test('GET /api/top-layouts?n=2 returns up to 2 layouts', async () => {
  const body = await json('/api/top-layouts?n=2');
  expect(Array.isArray(body)).toBe(true);
  expect(body.length).toBeLessThan(3);
  if (body.length > 0) {
    expect(body[0]).toHaveProperty('layout_json');
    expect(body[0]).toHaveProperty('win_rate');
  }
}, { component: 'Worker API', control: 'A1.2' });

test('GET /api/stats returns numeric counts', async () => {
  const body = await json('/api/stats');
  expect(typeof body.layouts).toBe('number');
  expect(typeof body.states).toBe('number');
}, { component: 'Worker API', control: 'A1.2' });

authTest('POST /api/record without API key returns 401', async () => {
  const res = await fetch(`${API_BASE_URL}/api/record`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ layout_json: '[]', win: true })
  });
  expect(res.status).toBe(401);
}, { component: 'Worker API', control: 'CC6.1' });

authTest('POST /api/record with valid payload returns 200', async () => {
  const layout = JSON.stringify([{ name: 'TestCarrier', positions: [{ row: 0, col: 0 }] }]);
  const res = await fetch(`${API_BASE_URL}/api/record`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...commonHeaders },
    body: JSON.stringify({ layout_json: layout, win: false })
  });
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.recorded).toBe(true);
}, { component: 'Worker API', control: 'CC7.2' });

authTest('POST /api/record rejects invalid win type', async () => {
  const res = await fetch(`${API_BASE_URL}/api/record`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...commonHeaders },
    body: JSON.stringify({ layout_json: '[]', win: 'yes' })
  });
  expect(res.status).toBe(400);
}, { component: 'Worker API', control: 'CC6.6' });

authTest('POST /api/record rejects oversized layout_json', async () => {
  const huge = 'x'.repeat(3000);
  const res = await fetch(`${API_BASE_URL}/api/record`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...commonHeaders },
    body: JSON.stringify({ layout_json: huge, win: true })
  });
  expect(res.status).toBe(400);
}, { component: 'Worker API', control: 'CC6.6' });

authTest('POST /api/merge-weights without API key returns 401', async () => {
  const res = await fetch(`${API_BASE_URL}/api/merge-weights`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ delta: {} })
  });
  expect(res.status).toBe(401);
}, { component: 'Worker API', control: 'CC6.1' });

authTest('POST /api/merge-weights rejects an invalid delta', async () => {
  const res = await fetch(`${API_BASE_URL}/api/merge-weights`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...commonHeaders },
    body: JSON.stringify({ delta: { bad: 'value' } })
  });
  expect(res.status).toBe(400);
}, { component: 'Worker API', control: 'CC6.6' });

authTest('POST /api/merge-weights accepts a valid delta and updates weight map', async () => {
  const stateKey = '0'.repeat(100);
  const delta = { [stateKey]: [[0, 0, 1, 1]] };
  const res = await fetch(`${API_BASE_URL}/api/merge-weights`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...commonHeaders },
    body: JSON.stringify({ delta })
  });
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.merged).toBe(true);
  expect(body.states).toBeGreaterThan(0);
}, { component: 'Worker API', control: 'CC7.2' });

authTest('Rate limiting blocks excessive write requests from one IP', async () => {
  const statuses = [];
  const payload = JSON.stringify({ layout_json: 'not-json', win: true });
  for (let i = 0; i < 35; i++) {
    const s = await status('/api/record', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...commonHeaders },
      body: payload
    });
    statuses.push(s);
  }
  expect(statuses.some(s => s === 429)).toBe(true);
}, { component: 'Worker API', control: 'CC7.3' });
