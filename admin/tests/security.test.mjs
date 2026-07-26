import { test, test as harnessTest, expect, getEnv } from '../lib/harness.mjs';

const API_BASE_URL = getEnv('API_BASE_URL', 'https://battleship-rl-api.battleship-rl.workers.dev');
const API_KEY = getEnv('API_KEY', '');

const allowedOrigin = 'https://alc168.github.io';
const disallowedOrigin = 'https://evil.com';

test('OPTIONS preflight from allowed origin returns 204 with CORS headers', async () => {
  const res = await fetch(`${API_BASE_URL}/api/record`, {
    method: 'OPTIONS',
    headers: {
      Origin: allowedOrigin,
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'Content-Type, X-API-Key'
    }
  });
  expect(res.status).toBe(204);
  expect(res.headers.get('Access-Control-Allow-Origin')).toBe(allowedOrigin);
}, { component: 'Security', control: 'CC6.6' });

test('OPTIONS preflight from disallowed origin is rejected with 403', async () => {
  const res = await fetch(`${API_BASE_URL}/api/record`, {
    method: 'OPTIONS',
    headers: {
      Origin: disallowedOrigin,
      'Access-Control-Request-Method': 'POST'
    }
  });
  expect(res.status).toBe(403);
}, { component: 'Security', control: 'CC6.6' });

test('POST from a disallowed origin is rejected with 403', async () => {
  const headers = { 'Content-Type': 'application/json', Origin: disallowedOrigin };
  if (API_KEY) headers['X-API-Key'] = API_KEY;
  const res = await fetch(`${API_BASE_URL}/api/record`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ layout_json: '[]', win: true })
  });
  expect(res.status).toBe(403);
}, { component: 'Security', control: 'CC6.6' });
