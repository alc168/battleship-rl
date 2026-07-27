# Battleships RL

A browser-based Battleship game in which a human plays against a computer opponent that learns from every game. The computer improves its ship placement by copying successful human layouts and improves its shooting through continuous self-play. All learning is shared across players via a Cloudflare Worker API backed by Cloudflare D1 and KV.

**Live game:** [https://alc168.github.io/battleships-rl/](https://alc168.github.io/battleships-rl/)  
**API:** [https://battleship-rl-api.battleship-rl.workers.dev](https://battleship-rl-api.battleship-rl.workers.dev)

---

## Inspiration

The game is a modern, self-learning take on the classic Milton Bradley board game. Its sound effects pay homage to the operatic 1975 Milton Bradley *Battleship* television commercial, which staged naval combat with straight-faced theatricality and fortune-cookie asides. The in-game audio and Computer Tactical Console are intended to capture the same toy-theatre tone.

[Watch the original 1975 commercial on YouTube](https://www.youtube.com/watch?v=VXkVZ0rloio)

---

## Table of contents

1. [Objectives](#objectives)
2. [What it does](#what-it-does)
3. [Pre-training](#pre-training)
4. [Architecture at a glance](#architecture-at-a-glance)
5. [Components](#components)
6. [Data flow](#data-flow)
7. [Cost and risk notes](#cost-and-risk-notes)
8. [Security](#security)
9. [Quickstart](#quickstart)
10. [Testing](#testing)
11. [Deployment](#deployment)
12. [Repository map](#repository-map)
13. [University tutorial](README.md)

---

## Objectives

The project is designed around four priorities, in order:

1. **Player experience** — every computer move must feel instant, the UI must be responsive on desktop and mobile, and the game must be fun to play repeatedly.
2. **Low cost** — the system should run comfortably inside Cloudflare's free tiers for a hobby-scale audience.
3. **Elegance** — keep the architecture simple, avoid unnecessary backend state, and run as much logic as possible in the browser.
4. **Self-improvement** — the computer should learn from every human game and from its own practice games, and that learning should be shared across sessions.

---

## What it does

- A human places five ships on a 10x10 grid and then takes turns firing at the computer's hidden fleet.
- The computer places its own ships by copying high-performing human layouts it has seen before.
- The computer chooses shots using a learned "weight map" that maps board states to the coordinates most likely to lead to victory.
- If the weight map has no entry for a state, the computer falls back to hunt logic around known hits and then random fire.
- While the game runs, a Web Worker plays batches of self-play games, producing win-rate deltas that are merged into the global weight map.
- Every finished human game is recorded in D1, so the computer can learn which ship placements win.
- A Computer Tactical Console shows live training logs, the computer's current thinking, a firing probability heatmap, combat statistics, and a humour dial.

---

## Pre-training

The live browser game learns from every human game, but the computer also benefits from offline DQN self-play on local hardware. A PyTorch DQN plays large batches of Battleship games, updates Q-values from a replay buffer, and periodically exports a static `ai_policy.json` lookup table. The web build can load this file as a starting policy, and `training.worker.js` continues to refine the policy in real time as real games are played.

For the full methodology, the `ai_policy.json` format, and how the React game consumes the policy, see [PRETRAINING.md](PRETRAINING.md).

---

## Architecture at a glance

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

The architecture is a **hybrid edge with in-browser training**:

- All move decisions are made in the browser, so there is no network latency during a turn.
- Heavy simulation is offloaded to a Web Worker, keeping the UI responsive.
- The Cloudflare Worker holds the only secrets and persists data to D1 and KV.
- GitHub Pages hosts the static build.

For the full design, data model, API surface, and cost analysis, see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

---

## Components

### Frontend (React + Vite)

- Renders the two grids, handles placement and attack clicks, and enforces game rules.
- Loads the current weight map and top human layouts when the page opens.
- Spawns a Web Worker that trains continuously while the game is active.
- POSTs finished human games and training deltas to the Worker.
- Displays the Computer Tactical Console by default.

### Web Worker (`web/src/training.worker.js`)

- Runs in a background thread so the UI stays responsive.
- Plays batches of 250 self-play games (configurable through `web/src/training.config.js`).
- For every shot, records the board state and the coordinate fired.
- Generates all seven symmetric variants (rotations and reflections) of each recorded state.
- If the shooter wins, every recorded shot and its symmetric variants are credited with a win.
- Returns a compact delta of `(board_key, coordinate)` win-rate updates.

### Cloudflare Worker (`worker/index.js`)

- A serverless API at the edge.
- Holds the D1 and KV bindings so the browser never sees credentials.
- Endpoints:
  - `GET /api/weight-map` — current shot-priority map from KV.
  - `GET /api/top-layouts` — best human ship layouts from D1.
  - `POST /api/record` — store a finished human game in D1.
  - `POST /api/merge-weights` — merge a training delta into KV.
  - `GET /api/stats` — aggregate counts for the UI.
- Enforces CORS, API-key authentication on writes, payload validation, and per-IP rate limiting backed by D1.

### Cloudflare D1

- Stores up to 10,000 human ship layouts and their win/loss records.
- Each row: `layout_json`, `wins`, `games`, `win_rate`, `last_played`.
- Also stores per-IP rate-limit windows.

### Cloudflare KV

- Stores the `weight_map` JSON object.
- Key: a 100-character string representing the computer's view of the enemy board.
- Value: a sorted list of `[row, col, win_rate, wins, samples]` arrays.
- Also stores the running `synthetic_games` counter.

---

## Data flow

1. Page loads.
2. Browser fetches `/api/weight-map` and `/api/top-layouts`.
3. Player places ships and plays turns; all computer decisions use in-memory data.
4. Web Worker runs 250-game batches in the background.
5. Every `UPLOAD_INTERVAL_BATCHES` batches, the browser POSTs the accumulated delta to `/api/merge-weights`.
6. Worker merges the delta into KV.
7. When a real game ends, the browser POSTs the result to `/api/record` and D1 is updated.

---

## Cost and risk notes

The project is configured to stay within Cloudflare's free tiers for a small audience, but the free tiers are real limits that can be exhausted.

| Service | Free limit | Relevant operations |
|---|---|---|
| Workers | 100,000 requests/day | Every API call and page asset |
| KV | 100,000 reads/day, 1,000 writes/day | `weight_map` and `synthetic_games` |
| D1 | 5M rows read/day, 100,000 rows written/day | `layouts` queries and upserts |

With the default `COST_FIRST` training preset, a single player produces roughly one `merge-weights` upload every 300 seconds, which is well under the KV write limit. `EXPERIENCE_FIRST` is much more aggressive and is intended for paid plans.

Known scaling risks:

- `GET /api/top-layouts` and the `/api/record` prune query can scan the `layouts` table as it grows.
- `GET /api/stats` reads KV twice and runs two D1 aggregates per page load and per finished game.
- The weight map value size can approach KV's 25 MiB per-value limit as the number of stored states grows.

For a detailed cost model, mitigation strategies, and a what-if analysis, see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

---

## Security

- API keys are held as Cloudflare Worker secrets, not in the browser bundle (the build-time `VITE_API_KEY` is embedded in the compiled JavaScript, which is the standard trade-off for a shared client key).
- D1 queries use parameterized bindings.
- POST endpoints require the API key and enforce per-IP rate limits.
- API-key comparison uses `crypto.subtle.timingSafeEqual`.
- CORS is restricted to known origins; `localhost` is allowed for local development but should be removed from production.

---

## Quickstart

```bash
# Install dependencies
cd web
npm install

# Run the Vite dev server
npm run dev

# Run lint
npx oxlint src/

# Build for production
npm run build

# Deploy to GitHub Pages
npm run deploy
```

For the Worker:

```bash
cd worker
npm install

# Local dev
npm run dev

# Deploy
npx wrangler deploy
```

You will need a `web/.env` file with:

```
VITE_API_BASE_URL=https://battleship-rl-api.battleship-rl.workers.dev
VITE_API_KEY=<your-shared-api-key>
VITE_TRAINING_MODE=COST_FIRST
```

---

## Testing

```bash
cd admin
npm test
```

The admin harness runs tests for game utilities, the training worker, the Worker API, and CORS/security controls. Some tests require an `admin/.env` with a valid `API_KEY`.

---

## Deployment

1. Update `web/.env` and `worker/.dev.vars` with the real `API_KEY` and API URL.
2. Run `npm run deploy` inside `web/` to publish to GitHub Pages.
3. Run `npx wrangler deploy` inside `worker/` to publish the Worker.

## Credits

- Code and development workflow by [Devin](https://devin.ai).
- Voice and sound effects by [ElevenLabs](https://elevenlabs.io).
- Edge hosting, API, D1, and KV by [Cloudflare](https://www.cloudflare.com).

---

## Repository map

- [PRETRAINING.md](PRETRAINING.md) — local DQN self-play pipeline, `ai_policy.json` format, and how the React game consumes the policy.
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — full architecture, data model, API surface, cost/risk analysis, and roadmap.
- [docs/HISTORY.md](docs/HISTORY.md) — how the architecture evolved and the key decisions behind it.
- [docs/DEBUG_LOG.md](docs/DEBUG_LOG.md) — major bugs found during development and how they were resolved.
- `web/` — React + Vite frontend.
- `worker/` — Cloudflare Worker API.
- `admin/` — test harness and reports.
