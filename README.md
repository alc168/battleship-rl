# Battleships - RL v1.0a — Design and Operation

A browser-based Battleship game where a human plays against a computer opponent. The computer learns from every human game and from continuous self-play, storing what it learns in Cloudflare D1 and KV behind a Cloudflare Worker API.

Live game: `https://alc168.github.io/battleships-rl/`  
API: `https://battleship-rl-api.battleship-rl.workers.dev`

---

## Inspiration for the game

The game's personality grew out of the 1975 Milton Bradley *Battleship* television
commercial — the operatic, naval-battle staging of a children's board game. The
intro audio (`battleshipsintro.mp3`) and on-screen text echo that dramatic,
toy-theatre tone.

You can watch the original commercial here:  
[Milton Bradley Battleship game Opera TV commercial, 1975](https://www.youtube.com/watch?v=VXkVZ0rloio)

The **Computer Tactical Console** lets you move the computer from **Pragmatic**
(dry military brief) through **Wry**, **Cheeky**, and **Philosophical**. The
higher settings lean into British understatement, stiff-upper-lip delivery,
absurdist naval metaphysics and fortune-cookie asides — all voiced with the same
straight-faced theatricality as the advert.

## Table of contents

1. [Inspiration for the game](#inspiration-for-the-game)
2. [Pre-training](#pre-training)
3. [What it does](#what-it-does)
4. [Components and architecture](#components-and-architecture)
5. [How the computer makes a move](#how-the-computer-makes-a-move)
6. [How the computer improves over time](#how-the-computer-improves-over-time)
7. [Data flow](#data-flow)
8. [Security](#security)
9. [Testing harness](#testing-harness)
10. [Efficiency, responsiveness and cost-effectiveness](#efficiency-responsiveness-and-cost-effectiveness)
11. [Configuration](#configuration)
12. [Deployment](#deployment)
13. [Development](#development)
14. [Further reading](#further-reading)

---

## What it does

- A human places five ships on a 10×10 grid and takes turns firing at the computer's hidden fleet.
- The computer places its ships using the best human layouts it has seen, then uses a learned "weight map" to pick shots.
- While the game is active, a Web Worker simulates hundreds of Battleship games in the background.
- The worker augments every recorded board state with its 7 symmetric rotations/reflections, multiplying effective training data by 8.
- The results update the computer's shot-priority table, which is merged back to Cloudflare KV for the next game.
- Every finished human game is recorded in Cloudflare D1, so the computer can learn which ship placements win.
- A **Computer Tactical Console** shows live training logs, the computer's current "thinking", a real-time probability heatmap, and a personality dial from Pragmatic to Philosophical.

---

## Pre-training

The live browser game learns from every human game, but the computer also
benefits from offline DQN self-play on local hardware. A PyTorch DQN plays
large batches of Battleship games, updates Q-values from a replay buffer, and
then evaluates a "Teacher" network to write a pre-computed `ai_policy.json`
lookup table. Each key is a 100-character board state; each value is a ranked
list of recommended shots, so the browser can look up a move instantly without
running a neural network.

The training runs on a **MacBook Air M4** (using Metal / `mps`) and an
**Ubuntu laptop** (CPU only). The Mac is configured to push an updated
`ai_policy.json` to GitHub every hour; the Ubuntu trainer runs locally for
extra self-play experience and does not push. Both trainers resume from
`dqn_battleship.pt`, `checkpoint.json` and the existing `ai_policy.json`, so
they can stop and restart without losing progress.

For the full methodology, the `ai_policy.json` format, and how the React game
consumes the policy, see [`PRETRAINING.md`](PRETRAINING.md).

## Components and architecture

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
│   + symmetry aug.   │                                             └──────────────┘  └──────────────┘
└─────────────────────┘
```

### Frontend (React + Vite)

- Renders the two 10×10 grids, handles placement/attack clicks, and enforces the game rules.
- Downloads the current `weight_map` once when the page loads.
- Spawns a Web Worker to run self-play training continuously while the game is active.
- POSTs finished human games and training deltas to the Cloudflare Worker.
- Displays the **Computer Tactical Console** by default, with a heatmap that updates live and preserves historical probabilities on fired cells.

### Web Worker

- Runs in a background thread so the UI stays responsive.
- Plays batches of **500** self-play games.
- For every shot, records the `board_key` and `coordinate`.
- Generates all 7 symmetric variants (90°, 180°, 270°, horizontal flip, vertical flip, transpose, anti-diagonal) of each recorded state, storing the same action recommendation for every variant.
- If the shooter wins the game, all recorded shots (and their symmetric counterparts) are credited with wins.
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
- Human layouts are written through `POST /api/record` as JSON arrays of ship objects; the worker validates length and structure and uses parameterized SQL inserts.

### Cloudflare KV

- Stores the `weight_map` JSON object.
- Key: a 100-character string representing the computer's view of the enemy board.
- Value: a sorted list of `[row, col, win_rate, wins, samples]` arrays.
- Updated by `POST /api/merge-weights` after validation.

---

## How the computer makes a move

### Ship placement

1. At game start, the app fetches `top-layouts` from D1.
2. It picks one of the top three layouts at random.
3. It copies that layout onto the computer's grid.
4. If no layouts exist, it falls back to random placement.

### Shooting

1. The computer creates a 100-character `board_key` from its view of the enemy board.
2. `getAiMove` tries, in order:
   - an exact match in the `weight_map`;
   - the `empty_board` policy for mostly empty boards;
   - the closest known board state within a Hamming distance of 6.
3. If a known state is found, it fires at the highest-rated coordinate it has not already shot.
4. If no key is known, or all stored cells have been shot, it uses hunt logic (target around unsunk hits) and then random fire.

### Sinking a discovered ship

When the computer hits a ship, adjacent cells are added to a hunt queue. The computer empties that queue before returning to the weight map, so a discovered ship is sunk as fast as possible.

---

## How the computer improves over time

The learning is a lightweight **Monte Carlo reinforcement-learning** approach. No neural network is used in the live game; instead, the computer keeps a table of win rates for every `(board state, action)` pair.

### Shooting policy

- During self-play, the worker records every `(board_key, coordinate)` fired by the shooter.
- Each recorded state is immediately expanded into its 7 symmetric equivalents, giving 8x more data per game.
- If the shooter wins the game, every recorded shot is credited with a win.
- For each state, actions are ranked by `wins / samples`.
- The top **20** actions per state are kept in KV (`MAX_ACTIONS_PER_STATE` = 20).
- `getAiMove` can also reuse policies from nearby states, reducing random fallbacks.
- Over many batches, the policy converges on the squares that are most likely to lead to victory from each board state.

### Placement policy

- When a human finishes a game, the app POSTs the human's ship layout (`playerShipPositions`) and the result to D1.
- The worker validates the payload, then upserts the `layouts` table with `wins`, `games`, and `win_rate`.
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
    │        ├── Each recorded shot is mirrored across 7 symmetries
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
- **Payload validation**:
  - `/api/record` checks `layout_json` length and `win` boolean.
  - `/api/merge-weights` checks state/action count, coordinate bounds, and total delta size.
- **Rate limiting**: 30 write requests per IP per minute.
- **Input sanitisation**: all JSON payloads are parsed defensively and rejected on malformed data.

### Recommendations for production

- Rotate the `API_KEY` periodically.
- Monitor D1/KV usage in the Cloudflare dashboard and add stricter rate limits if needed.
- Consider per-user or per-session tokens instead of a single shared key if the game becomes public.

---

## Testing harness

A dedicated test suite lives in `admin/`. It runs on demand, validates every component, and writes a timestamped Markdown + JSON report.

### What is tested

| Component | Coverage | SOC 2 control |
|---|---|---|
| **Game logic** | Grid creation, placement, attacks, win detection, ship sinking, board keys, AI move selection, incomplete-pattern handling | CC7.2 |
| **Training worker** | 500-game batch completes, symmetry augmentation, progress events emitted, delta returned | CC7.2 |
| **Worker API** | `weight-map`, `top-layouts`, `stats` availability; `record` and `merge-weights` success/failure cases | A1.2, CC7.2 |
| **Authentication** | Missing/invalid API keys rejected on write endpoints | CC6.1 |
| **Input validation** | Oversized/malformed payloads rejected | CC6.6 |
| **CORS** | Allowed origins pass preflight; disallowed origins are blocked | CC6.6 |
| **Rate limiting** | Excessive write requests receive `429 Too Many Requests` | CC7.3 |

### Latest results

```text
36/36 passed in 9.53s
0 failed, 0 skipped
```

Reports are written to `admin/reports/latest.md` and `admin/reports/latest.json`.

### Run tests locally

```bash
cd admin
cp .env.example .env
# edit .env with your API_BASE_URL and API_KEY
npm test
```

### Publish the admin report to GitHub Pages

```bash
cd web
npm run admin:publish
npm run deploy
```

---

## Efficiency, responsiveness and cost-effectiveness

### Efficiency

- **Sparse tabular policy**: only the most useful `(state, action)` pairs are stored. The worker keeps at most 20 actions per state, pruning rarely-seen ones.
- **Symmetry augmentation**: 8× effective data from the same 500 self-play games, giving much better coverage without extra CPU time.
- **Early-exit Hamming search**: `getAiMove` can stop comparing keys as soon as a candidate exceeds the distance threshold.
- **Compact delta format**: actions are sent as 4-element integer arrays and merged incrementally, minimising KV write size.

### Responsiveness

- The Web Worker runs self-play off the main thread, so clicks and animations stay smooth even while 500 games are simulated.
- `weight_map` is fetched once at page load; subsequent training updates are merged locally and uploaded in small deltas.
- The Computer Tactical Console updates from the same state transitions as the game, so the heatmap and decision log are always in sync.
- `getAiMove` uses exact-key, empty-board, and nearest-state lookups, keeping shot selection fast (O(1) average, bounded Hamming scan).

### Cost-effectiveness

- **Cloudflare free tier**: static hosting on GitHub Pages, edge compute with the Worker, D1 for SQLite, and KV for the weight map all have generous free allowances.
- **Batched KV writes**: one `merge-weights` call per 500-game batch keeps KV write operations low.
- **Bounded storage**: D1 layouts are capped at 10,000 rows; KV states are pruned at 100,000 keys; deltas are limited to 2 MB.
- **Throttled training**: `CONTINUOUS_INTERVAL_MS` pauses between batches and training pauses when the tab is hidden, saving CPU and bandwidth.

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
cd worker
cp .dev.vars.example .dev.vars
# edit .dev.vars
```

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

## Development

```bash
cd web
npm install
npm run dev
```

The Vite dev server starts on `http://localhost:5173`.

---

## Audio

The sound effects are a deliberate homage to the Milton Bradley *Battleship* television commercial that aired in 1975. That spot is remembered for its operatic, naval-battle staging of the classic board game, and the in-game audio cues echo its dramatic, toy-theatre tone.

You can watch the original 1975 commercial here:  
[Milton Bradley Battleship game Opera TV commercial, 1975](https://www.youtube.com/watch?v=VXkVZ0rloio)

---

## Further reading

- `PRETRAINING.md` — local DQN self-play pipeline, `ai_policy.json` format, and how the React game consumes the policy
- `BRIEFING.md` — university-level architecture and RL overview
- `BRIEFING_AI_IMPROVEMENTS.md` — why the AI falls back to random and future improvement proposals
- `ARCHITECTURE.md` — earlier system design notes
- `admin/README.md` — how to run the test harness
