# Battleship RL — Architecture, Technologies and Learning Briefing

## 1. What the project does

This is a browser-based Battleship game. A human places ships on a 10×10 grid, then takes turns firing at a computer opponent. While the game is being played, the computer is also learning: it remembers successful human ship placements and runs thousands of simulated practice games in the background to discover which squares to shoot in each situation.

The learning is stored in the cloud, so the computer improves across every game played by every user.

---

## 2. The main components

### Frontend (React + Vite)

- Runs inside the player's web browser.
- Draws the two grids, handles clicks, enforces placement rules, and runs the turn loop.
- Downloads the current "cheat sheet" (the **weight map**) once when the page loads.
- Spawns a **Web Worker** so heavy number-crunching does not freeze the user interface.
- Sends each finished human game to the Cloudflare Worker.

### Web Worker

- A separate JavaScript thread that runs in the browser.
- Plays batches of **500** short Battleship games against itself.
- For each shot fired, it records the board state, the coordinate chosen, and whether that shot belonged to a side that eventually won.
- Returns a small **delta** — an update to the weight map.

### Cloudflare Worker

- A tiny, serverless API that lives on Cloudflare's edge network.
- Holds the secret bindings to the database and key-value store, so the browser never sees credentials.
- Exposes four endpoints:
  - `GET /api/weight-map` — fetch the current shooting cheat sheet.
  - `GET /api/top-layouts` — fetch the best human ship layouts.
  - `POST /api/record` — record a finished human game.
  - `POST /api/merge-weights` — merge a training delta into the cheat sheet.

### Cloudflare D1

- A small, serverless SQL database.
- Stores up to **10,000** human ship layouts and each layout's `wins`, `games`, and `win_rate`.
- The computer uses the top-ranked layouts for its own ship placement.

### Cloudflare KV

- A fast key-value store.
- Holds the **weight map**: a JSON object that maps board-state strings to a ranked list of shooting coordinates.
- The React app downloads this object at the start of a session.

### GitHub Pages

- Hosts the static React build at `https://alc168.github.io/battleship-rl/`.
- The Cloudflare Worker is served separately at a `workers.dev` URL.

---

## 3. How the computer chooses a move

### Ship placement

1. At the start of a game, the app fetches the top human layouts from D1.
2. It randomly picks one of the top three.
3. That layout is copied onto the computer's grid.

If no human layouts exist yet, the computer uses a random placement.

### Shooting

1. The computer looks at its view of the enemy board: unknown, miss, hit, or sunk.
2. That view is converted into a 100-character string key (e.g. `000120...0`).
3. It looks up the key in the weight map.
4. If the key exists, it fires at the highest-rated coordinate that it has not already shot.
5. If the key is missing, it falls back to simple hunt logic (target around known hits) or a random shot.

---

## 4. How the computer improves over time (reinforcement learning)

This is a lightweight form of **Monte Carlo reinforcement learning**. The computer does not use a neural network for the live game; instead, it keeps a table of win rates for every `(board state, action)` pair it has seen.

### Learning to shoot better

- The Web Worker plays many games of the AI shooting at random opponents.
- For every shot the AI fires, it stores the `board_key` and the `coordinate`.
- If the AI wins that game, the `(board_key, coordinate)` pair is credited with a win.
- Over many games, each pair accumulates `wins` and `samples`.
- The **win rate** is `wins / samples`.
- For each board state, only the top actions by win rate are kept in KV (the weight map).
- As more games are played, the weight map becomes a better guide to which squares are most likely to lead to victory.

### Learning to place ships better

- When a human finishes a game, the app sends the human's ship layout to D1.
- If the human won, the layout's `wins` increase, which raises its `win_rate`.
- The computer chooses its own ships from the top-rated layouts.
- Over time, ship placements that lead to human victories become more common for the computer too.

### The continuous improvement loop

```
Player opens the game
    │
    ▼
App downloads the current weight_map from KV
    │
    ▼
Game starts  ──►  Web Worker begins 500-game self-play batch
    │                        │
    │                        ▼
    │                Worker produces a delta
    │                        │
    │                        ▼
    │          App merges delta into local weight_map
    │                        │
    │                        ▼
    │          App POSTs delta to /api/merge-weights
    │                        │
    │                        ▼
    │          KV is updated for the next player
    │
    ▼
Player finishes game  ──►  App POSTs result to /api/record
    │
    ▼
D1 updates human layout win rate
```

---

## 5. Training hyperparameters

These settings live in `web/src/training.config.js`:

| Parameter | `COST_FIRST` | `EXPERIENCE_FIRST` | Purpose |
|---|---|---|---|
| `GAMES_PER_BATCH` | 500 | 500 | How many self-play games run in one Worker batch |
| `CHUNK_SIZE` | 50 | 50 | How often the Worker reports progress |
| `MAX_ACTIONS_PER_STATE` | 5 | 8 | How many top actions are kept for each board state |
| `MIN_SAMPLES_PER_ACTION` | 10 | 3 | Ignore rarely-seen actions |
| `MAX_STATES` | 20,000 | 100,000 | Hard cap on stored board states |
| `TRAINING_DELAY_MS` | 0 | 0 | Start training as soon as the game begins |
| `CONTINUOUS_INTERVAL_MS` | 5,000 | 2,000 | Pause between continuous batches |
| `ENABLE_ON_MOBILE` | false | true | Whether training runs on mobile devices |

`COST_FIRST` keeps KV/D1 usage close to the free tier. `EXPERIENCE_FIRST` trades a little more cost and CPU for faster, more responsive learning.

---

## 6. Security review

### What is safe

- No API keys, passwords, or tokens are committed to the repository.
- `web/.env` is ignored by Git and only exists locally during build.
- D1 queries are parameterized, so SQL injection is not possible.
- Cloudflare Worker bindings hold the secrets, not the browser bundle.

### What is exposed

- The API URL is public in the compiled JavaScript.
- `wrangler.toml` contains the D1 and KV resource IDs. These are not authentication tokens, but they are public if the repository is public.

### What could be abused

- `POST /api/record` and `POST /api/merge-weights` have **no authentication**. Anyone who knows the Worker URL can post fake game records or corrupted weight deltas.
- `Access-Control-Allow-Origin: *` allows any website to call the API from a browser.
- There is no rate limiting, so a determined attacker could flood the endpoints and increase Cloudflare usage.
- `POST /api/merge-weights` accepts arbitrary JSON. A very large delta could exceed the KV value limit or overwrite the weight map with junk.

### Recommended mitigations

1. Add a shared API key to `POST` endpoints and store it as a Cloudflare Worker secret.
2. Restrict CORS to the known GitHub Pages origin.
3. Validate `layout_json` length and `win` boolean on `/api/record`.
4. Validate and limit the size of `delta` on `/api/merge-weights`.
5. Add per-IP or global rate limiting inside the Worker.

---

## 7. Why these technologies were chosen

| Technology | Role | Reason |
|---|---|---|
| **React + Vite** | Frontend | Fast, modern, easy to deploy as static files. |
| **Web Workers** | Background training | Runs heavy simulation off the main UI thread. |
| **Cloudflare Worker** | API backend | Serverless, runs at the edge, holds secrets safely. |
| **Cloudflare D1** | Layout database | Cheap SQL with a generous free tier for tabular win/loss data. |
| **Cloudflare KV** | Weight map store | Extremely fast global reads for a JSON cheat sheet. |
| **GitHub Pages** | Static hosting | Free and simple for the React app. |
| **Wrangler** | Deployment tool | Official Cloudflare CLI for Workers and D1. |

---

## 8. Summary

The computer improves through two parallel learning processes:

1. **Placement learning** — it copies human ship layouts that win, using D1.
2. **Shooting learning** — it runs continuous self-play, credits winning shots, and keeps the highest win-rate actions in KV.

Every human game feeds back into the system, and every practice batch sharpens the shooting policy. The result is a Battleship AI that becomes harder to beat the more it is played.
