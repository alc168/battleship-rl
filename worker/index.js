// Cloudflare Worker API for Battleship RL
// Binds: env.DB (D1) and env.KV (KV)

const MAX_LAYOUT_JSON_LENGTH = 2000;
const MAX_DELTA_STATES = 10000;
const MAX_DELTA_ACTIONS_PER_STATE = 10;
const MAX_DELTA_BYTES = 2 * 1024 * 1024;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX = 30; // max POST requests per IP per minute

class RateLimiter {
  constructor() {
    this.requests = new Map();
  }

  isAllowed(key) {
    const now = Date.now();
    const timestamps = this.requests.get(key) || [];
    const recent = timestamps.filter(ts => now - ts < RATE_LIMIT_WINDOW_MS);
    if (recent.length >= RATE_LIMIT_MAX) return false;
    recent.push(now);
    this.requests.set(key, recent);
    return true;
  }
}

const limiter = new RateLimiter();

function isAllowedOrigin(request, env) {
  const origin = request.headers.get('Origin');
  if (!origin) return true; // non-browser clients such as curl
  const allowed = (env.ALLOWED_ORIGINS || 'https://alc168.github.io').split(',').map(s => s.trim()).filter(Boolean);
  return allowed.includes(origin);
}

function corsHeaders(origin) {
  const headers = {
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-API-Key',
    'Vary': 'Origin'
  };
  if (origin) headers['Access-Control-Allow-Origin'] = origin;
  return headers;
}

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...extraHeaders }
  });
}

function error(message, status = 400, extraHeaders = {}) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json', ...extraHeaders }
  });
}

function getClientIp(request) {
  const cf = request.headers.get('CF-Connecting-IP');
  if (cf) return cf;
  const xff = request.headers.get('X-Forwarded-For');
  if (xff) return xff.split(',')[0].trim();
  return 'unknown';
}

function checkApiKey(request, env) {
  if (!env.API_KEY) return true; // auth is optional until a key is configured
  const provided = request.headers.get('X-API-Key');
  return provided === env.API_KEY;
}

function validateLayout(layout_json, win) {
  if (typeof layout_json !== 'string') return 'layout_json must be a string';
  if (layout_json.length > MAX_LAYOUT_JSON_LENGTH) return 'layout_json too long';
  if (typeof win !== 'boolean') return 'win must be a boolean';
  try {
    const parsed = JSON.parse(layout_json);
    if (!Array.isArray(parsed)) return 'layout_json must be a JSON array';
  } catch {
    return 'layout_json is not valid JSON';
  }
  return null;
}

function validateDelta(delta) {
  if (!delta || typeof delta !== 'object' || Array.isArray(delta)) {
    return 'delta must be an object';
  }
  const states = Object.keys(delta);
  if (states.length > MAX_DELTA_STATES) return `delta exceeds ${MAX_DELTA_STATES} states`;

  let totalActions = 0;
  for (const [stateKey, actions] of Object.entries(delta)) {
    if (!Array.isArray(actions)) return `state ${stateKey} actions must be an array`;
    if (actions.length > MAX_DELTA_ACTIONS_PER_STATE) return `state ${stateKey} has too many actions`;
    totalActions += actions.length;
    for (const action of actions) {
      if (!Array.isArray(action) || action.length !== 4) {
        return `state ${stateKey} action is malformed`;
      }
      const [row, col, wins, samples] = action;
      if (!Number.isInteger(row) || row < 0 || row >= 10) return `state ${stateKey} has invalid row`;
      if (!Number.isInteger(col) || col < 0 || col >= 10) return `state ${stateKey} has invalid col`;
      if (!Number.isInteger(wins) || wins < 0) return `state ${stateKey} has invalid wins`;
      if (!Number.isInteger(samples) || samples < 0) return `state ${stateKey} has invalid samples`;
    }
  }

  const size = JSON.stringify(delta).length;
  if (size > MAX_DELTA_BYTES) return `delta is larger than ${MAX_DELTA_BYTES} bytes`;
  return null;
}

function mergeWeights(existing, delta) {
  const MAX_STATES = 100000;
  const MAX_ACTIONS = 8;
  const MIN_SAMPLES = 3;

  const merged = { ...existing };

  for (const [stateKey, actions] of Object.entries(delta)) {
    let list = merged[stateKey] ? merged[stateKey].map(a => [...a]) : [];

    for (const [row, col, dWins, dSamples] of actions) {
      const idx = list.findIndex(a => a[0] === row && a[1] === col);
      if (idx >= 0) {
        list[idx][3] += dWins;
        list[idx][4] += dSamples;
      } else {
        list.push([row, col, 0, dWins, dSamples]);
      }
    }

    for (const action of list) {
      action[2] = action[4] > 0 ? action[3] / action[4] : 0.0;
    }

    list = list.filter(a => a[4] >= MIN_SAMPLES);
    list.sort((a, b) => b[2] - a[2]);
    list = list.slice(0, MAX_ACTIONS);

    if (list.length) merged[stateKey] = list;
  }

  const keys = Object.keys(merged);
  if (keys.length > MAX_STATES) {
    const scored = keys.map(k => ({
      k,
      samples: merged[k].reduce((s, a) => s + a[4], 0)
    }));
    scored.sort((a, b) => b.samples - a.samples);
    const keep = new Set(scored.slice(0, MAX_STATES).map(s => s.k));
    const pruned = {};
    for (const k of keep) pruned[k] = merged[k];
    return pruned;
  }

  return merged;
}

async function getWeightMap(env) {
  const value = await env.KV.get('weight_map', 'json');
  return value || {};
}

async function putWeightMap(env, map) {
  await env.KV.put('weight_map', JSON.stringify(map));
}

export default {
  async fetch(request, env, ctx) {
    const origin = request.headers.get('Origin');
    const extraHeaders = corsHeaders(origin);

    if (request.method === 'OPTIONS') {
      if (!isAllowedOrigin(request, env)) {
        return new Response(null, { status: 403, headers: extraHeaders });
      }
      return new Response(null, { status: 204, headers: extraHeaders });
    }

    if (!isAllowedOrigin(request, env)) {
      return error('Origin not allowed', 403, extraHeaders);
    }

    const url = new URL(request.url);
    const clientIp = getClientIp(request);

    try {
      if (url.pathname === '/api/weight-map' && request.method === 'GET') {
        const map = await getWeightMap(env);
        return json(map, 200, extraHeaders);
      }

      if (url.pathname === '/api/top-layouts' && request.method === 'GET') {
        const n = Math.min(parseInt(url.searchParams.get('n')) || 3, 20);
        const { results } = await env.DB.prepare(
          `SELECT layout_json, wins, games, win_rate
           FROM layouts
           ORDER BY win_rate DESC, games DESC, last_played DESC
           LIMIT ?`
        ).bind(n).all();
        return json(results, 200, extraHeaders);
      }

      if (url.pathname === '/api/record' && request.method === 'POST') {
        if (!checkApiKey(request, env)) {
          return error('Invalid or missing API key', 401, extraHeaders);
        }
        if (clientIp !== 'unknown' && !limiter.isAllowed(clientIp)) {
          return error('Rate limit exceeded', 429, extraHeaders);
        }

        const body = await request.json().catch(() => ({}));
        const { layout_json, win } = body;

        const validationError = validateLayout(layout_json, win);
        if (validationError) return error(validationError, 400, extraHeaders);

        const ts = Date.now();
        const wins = win ? 1 : 0;

        await env.DB.batch([
          env.DB.prepare(
            `INSERT INTO layouts (layout_json, wins, games, win_rate, last_played)
             VALUES (?, ?, ?, ?, ?)
             ON CONFLICT(layout_json) DO UPDATE SET
               wins = wins + excluded.wins,
               games = games + excluded.games,
               win_rate = CAST(wins AS REAL) / games,
               last_played = excluded.last_played`
          ).bind(layout_json, wins, 1, wins, ts),
          env.DB.prepare(
            `DELETE FROM layouts
             WHERE layout_json NOT IN (
               SELECT layout_json FROM layouts
               ORDER BY win_rate DESC, games DESC, last_played DESC
               LIMIT 10000
             )`
          )
        ]);

        return json({ recorded: true }, 200, extraHeaders);
      }

      if (url.pathname === '/api/merge-weights' && request.method === 'POST') {
        if (!checkApiKey(request, env)) {
          return error('Invalid or missing API key', 401, extraHeaders);
        }
        if (clientIp !== 'unknown' && !limiter.isAllowed(clientIp)) {
          return error('Rate limit exceeded', 429, extraHeaders);
        }

        const body = await request.json().catch(() => ({}));
        const { delta } = body;

        const validationError = validateDelta(delta);
        if (validationError) return error(validationError, 400, extraHeaders);

        const existing = await getWeightMap(env);
        const merged = mergeWeights(existing, delta);
        await putWeightMap(env, merged);

        return json({ merged: true, states: Object.keys(merged).length }, 200, extraHeaders);
      }

      if (url.pathname === '/api/stats' && request.method === 'GET') {
        const { results } = await env.DB.prepare(
          'SELECT COUNT(*) as count FROM layouts'
        ).all();
        const layoutCount = results[0]?.count || 0;
        const weightMap = await getWeightMap(env);
        return json({ layouts: layoutCount, states: Object.keys(weightMap).length }, 200, extraHeaders);
      }

      return error('Not found', 404, extraHeaders);
    } catch (err) {
      console.error(err);
      return error(err.message || 'Internal error', 500, extraHeaders);
    }
  }
};
