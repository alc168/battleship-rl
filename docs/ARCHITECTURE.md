# Battleships RL — Architecture and Cost Risk Review

This document describes the current architecture, the data model, the API surface, the cost model, and the main operational risks for the `battleships-rl` project. It is intended for a technically literate reader who wants to understand why the system is built the way it is and where the free-tier boundaries lie.

---

## 1. Objectives and constraints

The architecture was chosen to satisfy four priorities, in order:

1. **Player experience** — every computer move must feel instant, the UI must work on desktop and mobile, and the game must remain fun across repeated plays.
2. **Low cost** — the system should run comfortably inside Cloudflare's free tiers for a hobby-scale audience.
3. **Elegance** — keep the design simple, avoid unnecessary backend state, and run as much logic as possible in the browser.
4. **Self-improvement** — the computer should learn from every human game and from continuous self-play, with that learning shared across all sessions.

The binding constraints are:

| Constraint | Target |
|---|---|
| Move latency | < 50 ms per computer shot |
| Page load | < 2 s on a 3G connection |
| Background training | 250–500 self-play games per session, no UI freeze |
| Shared memory | Learn from all players, not only the current browser |
| Storage cap | 10,000 human board layouts; weight map under KV per-value limit |
| Cost | Prefer free; accept up to $5/month for hobby scale |

---

## 2. Current architecture: hybrid edge with in-browser training

The recommended and deployed architecture is a hybrid: a static React frontend hosted on GitHub Pages, a Cloudflare Worker API, Cloudflare D1 for human layout history, and Cloudflare KV for the learned shooting policy.

### 2.1 Component diagram

```
+---------------+      GET weight-map / top-layouts      +------------------+
| GitHub Pages  | <------------------------------------> | Cloudflare Worker|
|  React + Vite |      POST record / merge-weights       |   API + secrets  |
+---------------+                                          +---------+--------+
       |                                                             |
       |  Spawns Web Worker for self-play                              |  D1
       v                                                             v
+------------------+                                          +---------------+
|   Web Worker     |                                          |  layouts      |
| 250-game batches |                                          +---------------+
| + symmetry aug.  |                                          +---------------+
+------------------+                                          |  weight_map   |
                                                              +---------------+
```

### 2.2 Components

#### Frontend (React + Vite)

- Renders the two 10x10 grids, handles placement and attack clicks, and enforces game rules.
- Loads the current `weight_map` and `top_layouts` once on page open.
- Spawns a Web Worker that trains continuously while the game is active.
- POSTs finished human games and training deltas to the Worker.
- Displays the Computer Tactical Console, which includes the computer's "thinking", a firing probability heatmap, combat statistics, and a humour dial.

#### Web Worker (`web/src/training.worker.js`)

- Runs in a background thread so the UI stays responsive.
- Plays batches of 250 self-play games by default.
- Records every `(board_key, coordinate)` pair fired by the shooter.
- Generates all seven symmetric variants of each recorded state, multiplying effective training data by eight.
- If the shooter wins, every recorded shot and its symmetric counterparts are credited with a win.
- Returns a compact delta of `(board_key, coordinate)` win-rate updates.

#### Cloudflare Worker (`worker/index.js`)

- Serverless edge API.
- Holds D1 and KV bindings so the browser never sees credentials.
- Enforces CORS, API-key authentication on writes, payload validation, and per-IP rate limiting backed by D1.

#### Cloudflare D1

- Stores up to 10,000 human ship layouts and win/loss records.
- Stores per-IP rate-limit windows.

#### Cloudflare KV

- Stores the `weight_map` JSON object under a single key.
- Stores the `synthetic_games` counter.

---

## 3. Data model

### 3.1 D1 `layouts` table

```sql
CREATE TABLE IF NOT EXISTS layouts (
  layout_json TEXT PRIMARY KEY,
  wins INTEGER DEFAULT 0,
  games INTEGER DEFAULT 0,
  win_rate REAL DEFAULT 0.0,
  last_played INTEGER
);
```

Each `layout_json` is a JSON string of the human's final ship placement. `wins` and `games` are upserted after every game; `win_rate` is recomputed as `wins / games`.

### 3.2 D1 `rate_limits` table

```sql
CREATE TABLE IF NOT EXISTS rate_limits (
  ip TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (ip, window_start)
);
```

Each POST endpoint checks the caller's IP against a rolling 60-second window. The table is D1-backed so the limit is consistent across all Cloudflare edge locations, unlike an in-memory `Map`.

### 3.3 KV `weight_map`

```json
{
  "0000000000...": [
    [0, 0, 0.62, 120, 193],
    [0, 2, 0.61, 98, 160],
    ...
  ],
  "0020000000...": [
    [5, 5, 0.74, 240, 324],
    ...
  ]
}
```

Each key is a 100-character board-state string. Each value entry is `[row, col, win_rate, wins, samples]`. Entries are pruned to the top `MAX_ACTIONS_PER_STATE` actions.

---

## 4. API surface

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/weight-map` | GET | Return the current `weight_map` from KV |
| `/api/top-layouts?n=3` | GET | Return the top `n` human layouts from D1 |
| `/api/record` | POST | Record a finished human game; update D1 |
| `/api/merge-weights` | POST | Merge a training delta into KV; rate-limited |
| `/api/stats` | GET | Return layout count, state count, human and synthetic game counts |

All POST endpoints require the `X-API-Key` header and are rate-limited. `OPTIONS` is restricted by origin.

---

## 5. Training and learning

### 5.1 Shooting policy

The learning is a lightweight **Monte Carlo reinforcement-learning** table:

- During self-play, the worker records every `(board_key, coordinate)` fired by the shooter.
- Each recorded state is expanded into its symmetric variants.
- If the shooter wins the game, every recorded shot is credited with a win.
- For each state, actions are ranked by `wins / samples`.
- The top `MAX_ACTIONS_PER_STATE` actions are kept in KV.

`getAiMove` tries, in order:

1. An exact match in `weight_map`.
2. The `empty_board` policy for boards with four or fewer known cells.
3. The closest known state within a Hamming distance of 6.
4. Hunt logic around unsunk hits, then random fire.

### 5.2 Placement policy

- When a human finishes a game, the app POSTs the human's ship layout and result to D1.
- The worker upserts the `layouts` table with `wins`, `games`, and `win_rate`.
- The computer picks one of the top three layouts at random for its own ships.
- If no layouts exist, it falls back to random placement.

### 5.3 Training presets

`web/src/training.config.js` defines two presets:

| Parameter | `COST_FIRST` | `EXPERIENCE_FIRST` |
|---|---|---|
| `GAMES_PER_BATCH` | 250 | 250 |
| `UPLOAD_INTERVAL_BATCHES` | 10 | 1 |
| `MAX_ACTIONS_PER_STATE` | 20 | 20 |
| `MIN_SAMPLES_PER_ACTION` | 3 | 3 |
| `MAX_STATES` | 20,000 | 100,000 |
| `CONTINUOUS_INTERVAL_MS` | 30,000 | 2,000 |
| `ENABLE_ON_MOBILE` | false | true |

`COST_FIRST` keeps Cloudflare usage close to the free tier. `EXPERIENCE_FIRST` trades cost and CPU for faster learning and is intended for paid plans.

---

## 6. Cost model and operational risks

### 6.1 Cloudflare free-tier limits

| Service | Free limit | What counts |
|---|---|---|
| Workers | 100,000 requests/day | Every API call and every static asset served from `workers.dev` |
| KV | 100,000 reads/day, 1,000 writes/day | Every `KV.get` and `KV.put` |
| D1 | 5,000,000 rows read/day, 100,000 rows written/day | Every row touched by a query |

Limits reset daily at 00:00 UTC. Exceeding any limit causes hard errors until the next reset.

### 6.2 Per-operation cost

| Operation | KV reads | KV writes | D1 rows read | D1 rows written |
|---|---:|---:|---:|---:|
| Page load (`weight-map` + `top-layouts` + `stats`) | 2 | 0 | ~1 + `layouts` scan | 0 |
| `POST /api/record` + `fetchStats` | 2 | 0 | ~10,000 (prune scan) + 2 | 2 |
| `POST /api/merge-weights` | 2 | 2 | 0 | 0 |

`GET /api/top-layouts` can scan the entire `layouts` table to sort and limit if no covering index exists. `POST /api/record` triggers a `DELETE ... WHERE layout_json NOT IN (SELECT ... ORDER BY ... LIMIT 10000)` which also scans the table.

### 6.3 What-if scenarios

| Scenario | Likely outcome |
|---|---|
| One player leaves the tab open for 24 hours in `COST_FIRST` | ~288 `merge-weights` uploads, ~576 KV writes, well under the 1,000/day write limit. |
| One player leaves the tab open in `EXPERIENCE_FIRST` | ~2,880 uploads, ~5,760 KV writes, exceeding the free KV write quota in a few hours. |
| 500 human games per day | 500 `POST /api/record` calls, each with a table scan; D1 row-read budget could be exhausted. |
| 1,000 page loads per day | 1,000 `stats` and `top-layouts` calls; D1 row reads could approach 10M/day. |
| Weight map reaches 100,000 states in `EXPERIENCE_FIRST` | KV value size could approach or exceed the 25 MiB per-value limit. |

### 6.4 Mitigations already in place

- `COST_FIRST` batches uploads to one per ~300 seconds.
- `MAX_ACTIONS_PER_STATE` and `MAX_STATES` cap the weight map size.
- Per-IP rate limiting prevents a single IP from flooding the write endpoints.
- API-key authentication prevents unauthenticated writes.
- D1 row count is capped at 10,000 layouts by the prune query.

### 6.5 Recommended mitigations

1. **Add a D1 index on `layouts` for `win_rate DESC, games DESC, last_played DESC`** to avoid full-table scans on `top-layouts` and the prune query.
2. **Move layout pruning from every `/api/record` call to a scheduled Worker** (e.g., a daily cron or a manual cleanup endpoint) so writes do not scan the entire table.
3. **Move `synthetic_games` from KV to D1** so `/api/stats` performs one KV read instead of two, and `/api/merge-weights` uses one KV read and one KV write.
4. **Cache `/api/stats` and `/api/top-layouts` in KV** with a short TTL to reduce D1 row reads under load.
5. **Shard the weight map by state prefix** once it approaches the 25 MiB per-value limit, or move historical snapshots to R2.
6. **Document that `EXPERIENCE_FIRST` is intended for paid plans** and enforce a runtime warning if it is used on a free account.

### 6.6 Weight-map state cap (`MAX_STATES`)

`worker/index.js` caps the merged `weight_map` at `MAX_STATES = 100_000` entries in `mergeWeights`. This number is a deliberate free-tier target, not a hard physical limit.

- The current `ai_policy.json` / `weight_map` holds **~80,000** states and is **~9.3 MiB**.
- At the current encoding (`[row, col, win_rate, wins, samples]`), that is roughly **0.117 kB per state**.
- **100,000 states** therefore translates to **~11.7 MiB**, safely under the KV 25 MiB per-value hard limit.
- The real free-tier bottleneck is not storage size but **Workers CPU time**: every `GET /api/weight-map` must `JSON.parse` the value and `JSON.stringify` it again for the response. A 9.3 MiB map already takes tens of milliseconds of CPU; increasing the cap to 150,000–200,000 would approach the 25 MiB value limit and likely exceed the **10 ms CPU budget** on the Workers Free plan.

Consequently, the cap should remain at **100,000** for a free-tier deployment. The `checkerboard` fallback in `getAiMove` covers states that are not in `weight_map`, so the DQN/learnt map only needs to store the true overrides from the baseline. If more states are needed later, the mitigation is architectural, not just raising the counter: shard by state prefix, move historical snapshots to R2, or move to Workers Paid for a 30-second CPU budget.

---

## 7. Security

- `API_KEY` is stored as a Cloudflare Worker secret, not in source code.
- The build-time `VITE_API_KEY` is embedded in the compiled JavaScript; this is a shared client key, which is the standard trade-off for an unauthenticated public game.
- D1 queries are parameterized.
- `checkApiKey` uses `crypto.subtle.timingSafeEqual` to avoid timing side-channels.
- CORS is restricted to known origins; `localhost` should be removed from the production `ALLOWED_ORIGINS`.
- `validateLayout` and `validateDelta` reject malformed or oversized payloads before they touch storage.
- The `delta` payload size is measured in bytes, not string length.

---

## 8. Alternatives considered

The original `ARCHITECTURE.md` documented five patterns. The current system is **Pattern E: Hybrid Edge with In-Browser Training**.

| Pattern | Move latency | Shared learning | Real-time training | Cost | Best for |
|---|---|---|---|---|---|
| A. Pure static + localStorage | Excellent | None | No | Free | Single-player demos |
| B. Edge persistence, offline training | Good | Limited | No | Free–$5 | Teacher model updated manually |
| C. Backend + Postgres + Redis | Slow | Yes | Possible | $10–$50+ | Tournaments, analytics |
| D. Colab batch model | Excellent | None | No | Free | Research pipeline |
| **E. Hybrid edge + in-browser** | Excellent | Yes | Yes | Free–$5 | **This project** |

Pattern E was chosen because it preserves instant moves, enables continuous cross-user learning, and stays within hobby budgets.

---

## 9. Roadmap

1. **Online learning from real games** — merge a delta built from actual live game move traces, reducing the self-play / live-play distribution mismatch.
2. **Wilson-score action ranking** — replace raw `wins / samples` with a confidence-adjusted score so rarely-seen actions remain available.
3. **Improved hunt targeting** — add parity, ship-size constraints, and "cannot fit" filtering.
4. **Production hardening** — remove `localhost` from `ALLOWED_ORIGINS`, add CI for build/lint/test, and add a key-rotation runbook.
5. **Weight-map sharding or R2 snapshots** — prepare for the day the KV value approaches 25 MiB.
