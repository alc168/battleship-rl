# Battleships - RL v1.0a — Design and Operation

A browser-based Battleship game where a human plays against a computer opponent. The computer learns from every human game and from continuous self-play, storing what it learns in Cloudflare D1 and KV behind a Cloudflare Worker API.

Live game: `https://alc168.github.io/battleship-rl/`  
API: `https://battleship-rl-api.battleship-rl.workers.dev`

---

## Table of contents

1. [What it does](#what-it-does)
2. [Architecture](#architecture)
3. [Technologies](#technologies)
4. [How the computer makes a move](#how-the-computer-makes-a-move)
5. [How the computer improves over time](#how-the-computer-improves-over-time)
6. [Data flow](#data-flow)
7. [Security](#security)
8. [Configuration](#configuration)
9. [Deployment](#deployment)
10. [Development](#development)
11. [Further reading](#further-reading)

---

## What it does

- A human places five ships on a 10×10 grid and takes turns firing at the computer's hidden fleet.
- The computer places its ships using the best human layouts it has seen, then uses a learned "weight map" to pick shots.
- While the game is being played, the browser runs a Web Worker that simulates hundreds of Battleship games in the background.
- The results of those games update the computer's shot-priority table, which is merged back to Cloudflare KV for the next game.
- Every finished human game is recorded in Cloudflare D1, so the computer can learn which ship placements win.

---

## Architecture

```
┌─────────────────────┐        GET weight-map / top-layouts        ┌──────────────────────┐
│   GitHub Pages      │ ◄────────────────────────────────────────► │   Cloudflare Worker  │
│   (React + Vite)    │ POST record / merge-weights (with API key) │   (API + secrets)    │
└─────────────────────┘                                            └──────────┬───────────┘
       │                                                                      │
       │  Spawns Web Worker for self-play                                     │
       ▼                                                                      ▼
┌─────────────────────┐                                             ┌──────────────┐  ┌──────────────┐
│   Web Worker        │                                             │   D1         │  │   KV         │
│   500-game batches  │                                             │   layouts    │  │   weight_map │
└─────────────────────┘                                             └──────────────┘  └──────────────┘
```

### Frontend (React + Vite)

- Renders the two 10×10 grids, handles placement/attack clicks, and enforces the game rules.
- Downloads the current `weight_map` once when the page loads.
- Spawns a Web Worker to run self-play training continuously while the game is active.
- POSTs finished human games and training deltas to the Cloudflare Worker.

### Web Worker

- Runs in a background thread so the UI stays responsive.
- Plays batches of **500** self-play games.
- For every shot, records the `board_key` and `coordinate`.
- If the shooter wins the game, those shots are credited with wins.
- Returns a compact `delta` of `(board_key, coordinate)` win-rate updates.

### Cloudflare Worker

- A serverless API at the edge.
- Holds the D1 and KV bindings so the browser never sees credentials.
- Endpoints:
  - `GET /api/weight-map` — current shot-priority map
  - `GET /api/top-layouts` — best human ship layouts
  - `POST /api/record` — store a finished human game
  - `POST /api/merge-weights` — merge a training delta into KV
  - `GET /api/stats` — layout count and state count
- Enforces CORS, API-key auth on writes, payload validation, and per-IP rate limiting.

### Cloudflare D1

- Stores up to **10,000** human ship layouts and their win/loss records.
- Each row: `layout_json`, `wins`, `games`, `win_rate`, `last_played`.
- Used to choose the computer's own ship placements.

### Cloudflare KV

- Stores the `weight_map` JSON object.
- Key: a 100-character string representing the computer's view of the enemy board.
- Value: a sorted list of `[row, col, win_rate, wins, samples]` arrays.

---

## Technologies

| Technology | Role |
|---|---|
| **React 19 + Vite** | Frontend game UI and build pipeline |
| **Web Workers** | Off-main-thread self-play training |
| **Cloudflare Worker** | Serverless API and secret holder |
| **Cloudflare D1** | SQLite database for human ship-layout statistics |
| **Cloudflare KV** | Fast global key-value store for the weight map |
| **Wrangler** | Cloudflare deployment and secret management |
| **GitHub Pages** | Static hosting for the React app |
| **gh-pages** | npm package that publishes `dist/` to GitHub Pages |

---

## How the computer makes a move

### Ship placement

1. At game start, the app fetches `top-layouts` from D1.
2. It picks one of the top three layouts at random.
3. It copies that layout onto the computer's grid.
4. If no layouts exist, it falls back to random placement.

### Shooting

1. The computer creates a 100-character `board_key` from its view of the enemy board.
2. It looks up that key in the `weight_map`.
3. If found, it fires at the highest-rated coordinate it has not already shot.
4. If no key exists, or all recommended cells have been shot, it uses hunt logic (target around unsunk hits) and then random fire.

### Sinking a discovered ship

When the computer hits a ship, adjacent cells are added to a hunt queue. The computer empties that queue before returning to the weight map, so a discovered ship is sunk as fast as possible.

---

## How the computer improves over time

The learning is a lightweight **Monte Carlo reinforcement-learning** approach. No neural network is used in the live game; instead, the computer keeps a table of win rates for every `(board state, action)` pair.

### Shooting policy

- During self-play, the worker records every `(board_key, coordinate)` fired by the shooter.
- If the shooter wins that game, every recorded shot is credited with a win.
- For each state, actions are ranked by `wins / samples`.
- Only the top actions are kept in KV (5 for `COST_FIRST`, 8 for `EXPERIENCE_FIRST`).
- Rarely-seen actions are discarded once enough data exists.
- Over many batches, the policy converges on the squares that are most likely to lead to victory from each board state.

### Placement policy

- When a human finishes a game, the app POSTs the human's ship layout and result to D1.
- If the human won, the layout's `wins` increase, raising its `win_rate`.
- The computer uses the highest `win_rate` layouts for its own ships.
- Successful human placements therefore become more common for the computer.

---

## Data flow

```
Page loads
    │
    ├── GET /api/weight-map  ──►  KV  ──►  browser keeps weightMap in state
    │
    ├── GET /api/top-layouts ──►  D1  ──►  placementMemory state
    │
    ▼
Game starts
    │
    ├── Web Worker starts 500-game batch
    │        │
    │        ▼
    │   Worker returns delta
    │        │
    │        ▼
    ├── Browser merges delta locally
    │        │
    │        ▼
    ├── POST /api/merge-weights  ──►  Worker validates and writes to KV
    │
    ▼
Human game ends
    │
    ├── POST /api/record  ──►  Worker validates and upserts D1 layout row
    │
    ▼
Next game uses updated weight_map and placements
```

---

## Security

### What is safe

- No API keys or `.env` files are committed to Git.
- The Cloudflare Worker, not the browser, owns the D1 and KV bindings.
- D1 inserts use parameterized queries, preventing SQL injection.

### Current protections

- **CORS** restricted to `https://alc168.github.io` and `http://localhost:5173`.
- **API-key auth** on `POST /api/record` and `POST /api/merge-weights` using an `X-API-Key` header.
- **Payload validation**: `layout_json` length and `win` type on `/api/record`; state/action count, coordinate bounds, and total size on `/api/merge-weights`.
- **Rate limiting**: 30 write requests per IP per minute.

### Recommendations for production

- Rotate the `API_KEY` periodically.
- Monitor D1/KV usage in the Cloudflare dashboard and add stricter rate limits if needed.
- Consider adding per-user or per-session tokens instead of a single shared key if the game becomes public.

---

## Configuration

### Web app (`web/.env`)

```env
VITE_API_BASE_URL=https://battleship-rl-api.battleship-rl.workers.dev
VITE_API_KEY=your-shared-api-key
VITE_TRAINING_MODE=COST_FIRST
```

### Worker (`worker/wrangler.toml` and `worker/.dev.vars`)

- `ALLOWED_ORIGINS` is a public var in `wrangler.toml`.
- `API_KEY` is a secret set via:

```bash
cd worker
npx wrangler secret put API_KEY
```

For local development:

```bash
cp worker/.dev.vars.example worker/.dev.vars
# edit .dev.vars with the same API_KEY and local ALLOWED_ORIGINS
cp web/.env.example web/.env
# edit .env with the same API_KEY
```

### Training modes (`web/src/training.config.js`)

| Parameter | `COST_FIRST` | `EXPERIENCE_FIRST` |
|---|---|---|
| `GAMES_PER_BATCH` | 500 | 500 |
| `CHUNK_SIZE` | 50 | 50 |
| `MAX_ACTIONS_PER_STATE` | 5 | 8 |
| `MIN_SAMPLES_PER_ACTION` | 10 | 3 |
| `TRAINING_DELAY_MS` | 0 | 0 |
| `CONTINUOUS_INTERVAL_MS` | 5000 | 2000 |
| `ENABLE_ON_MOBILE` | false | true |

`COST_FIRST` keeps usage close to the Cloudflare free tier. `EXPERIENCE_FIRST` trains faster and runs on mobile.

---

## Deployment

### Web app (GitHub Pages)

```bash
cd web
npm install
npm run deploy
```

`npm run deploy` runs `vite build` and publishes `dist/` to the `gh-pages` branch.

### Worker (Cloudflare)

```bash
cd worker
npx wrangler deploy
```

### D1 schema

```bash
cd worker
npx wrangler d1 execute battleship-rl-db --remote --file=./schema.sql
```

---

## Admin testing harness

A test suite lives in `admin/`. It runs on demand, validates every component (game logic, training worker, Worker API, security controls), and writes a timestamped Markdown + JSON report.

### What is tested

| Component | Test coverage | SOC 2 control |
|---|---|---|
| **Game logic** | Grid creation, placement, attacks, win detection, ship sinking, board keys, AI move selection | CC7.2 |
| **Training worker** | 500-game batch completes, progress events emitted, delta returned | CC7.2 |
| **Worker API** | `weight-map`, `top-layouts`, `stats` availability; `record` and `merge-weights` success/failure cases | A1.2, CC7.2 |
| **Authentication** | Missing/invalid API keys rejected on write endpoints | CC6.1 |
| **Input validation** | Oversized/malformed payloads rejected | CC6.6 |
| **CORS** | Allowed origins pass preflight; disallowed origins are blocked | CC6.6 |
| **Rate limiting** | Excessive write requests receive `429 Too Many Requests` | CC7.3 |

### Run tests locally

```bash
cd admin
cp .env.example .env
# edit .env with your API_BASE_URL and API_KEY
npm test
```

Reports are written to `admin/reports/latest.md` and `admin/reports/latest.json`.

### Publish the admin report to GitHub Pages

```bash
cd web
npm run admin:publish
npm run deploy
```

This runs the full test suite, copies `admin/index.html` to `web/public/admin.html` and `admin/reports/latest.json` to `web/public/admin-report.json`, then deploys. The report is then viewable at `https://alc168.github.io/battleship-rl/admin.html`.

---

## Development

```bash
# Install and run the web app locally
cd web
npm install
npm run dev

# Run the Worker locally
cd worker
npm install
npx wrangler dev
```

The local Vite dev server runs at `http://localhost:5173` by default. The local Worker runs at `http://localhost:8787`.

---

## Further reading

- `ARCHITECTURE.md` — original pattern comparison and cost estimates.
- `BRIEFING.md` — university-level summary of architecture, technologies, and reinforcement learning.
- `worker/index.js` — the Cloudflare Worker API implementation.
- `web/src/App.jsx` — the main React game loop and worker management.
- `web/src/training.worker.js` — the in-browser self-play engine.
