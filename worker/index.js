// Cloudflare Worker API for Battleship RL
// Binds: env.DB (D1) and env.KV (KV)

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }
  });
}

function error(message, status = 500) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }
  });
}

// Merge a training delta into the existing weight map.
// existing: { stateKey: [[row, col, win_rate, wins, samples], ...], ... }
// delta:    { stateKey: [[row, col, wins_delta, samples_delta], ...], ... }
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

    if (list.length) {
      merged[stateKey] = list;
    }
  }

  // Global state cap
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
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const url = new URL(request.url);

    try {
      if (url.pathname === '/api/weight-map' && request.method === 'GET') {
        const map = await getWeightMap(env);
        return json(map);
      }

      if (url.pathname === '/api/top-layouts' && request.method === 'GET') {
        const n = Math.min(parseInt(url.searchParams.get('n')) || 3, 20);
        const { results } = await env.DB.prepare(
          `SELECT layout_json, wins, games, win_rate
           FROM layouts
           ORDER BY win_rate DESC, games DESC, last_played DESC
           LIMIT ?`
        ).bind(n).all();
        return json(results);
      }

      if (url.pathname === '/api/record' && request.method === 'POST') {
        const body = await request.json().catch(() => ({}));
        const { layout_json, win } = body;
        if (!layout_json || typeof win !== 'boolean') {
          return error('layout_json and win are required', 400);
        }

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

        return json({ recorded: true });
      }

      if (url.pathname === '/api/merge-weights' && request.method === 'POST') {
        const body = await request.json().catch(() => ({}));
        const { delta } = body;
        if (!delta || typeof delta !== 'object') {
          return error('delta object is required', 400);
        }

        const existing = await getWeightMap(env);
        const merged = mergeWeights(existing, delta);
        await putWeightMap(env, merged);

        return json({ merged: true, states: Object.keys(merged).length });
      }

      if (url.pathname === '/api/stats' && request.method === 'GET') {
        const { results } = await env.DB.prepare(
          'SELECT COUNT(*) as count FROM layouts'
        ).all();
        const layoutCount = results[0]?.count || 0;
        const weightMap = await getWeightMap(env);
        return json({ layouts: layoutCount, states: Object.keys(weightMap).length });
      }

      return error('Not found', 404);
    } catch (err) {
      console.error(err);
      return error(err.message || 'Internal error', 500);
    }
  }
};
