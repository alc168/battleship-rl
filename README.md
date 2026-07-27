# Battleships RL: A University-Level Tutorial in Edge-AI Game Engineering

*Or: How to Sink Five Plastic Boats with Dignity, a Web Worker, and a Cloudflare Edge*

A standalone tutorial for reading the `battleships-rl` repository, understanding its architecture, and learning the core programming ideas it demonstrates — all without once getting your shoes wet.

---

## 1. Who this tutorial is for

This tutorial is aimed at university students who already know the basics of JavaScript, HTML and CSS, and who now wish to see how a real project combines React, a globally distributed serverless backend, a Web Worker, and a small but determined artificial intelligence into one theatrical little game.

By the end you should be able to:

1. Open the repository on GitHub and understand what each top-level directory does.
2. Follow the data flow from a human click to a database update.
3. Explain why the authors made each major design choice — possibly while wearing a captain's hat.
4. Identify the best-practice patterns that keep the system safe, cheap, and responsive.

> **A word from the Admiralty.** This document assumes you have heard of React, but not that you have committed any acts of piracy with it. If you have pirated React, please keep that to yourself.

---

## 2. The project in one paragraph

`battleships-rl` is a browser-based Battleship game where a human plays against a computer opponent that learns from every game. The computer learns two things:

- **Where to shoot:** from a global lookup table (`weight_map`) that maps board states to the coordinates most likely to win.
- **Where to place ships:** by remembering which human layouts win most often.

The frontend is a React + Vite app hosted on GitHub Pages. The backend is a Cloudflare Worker that authenticates requests, writes to a D1 SQLite database, and reads/writes a KV key-value store. A Web Worker runs self-play games in the background, uploading small win-rate deltas to the Worker so the computer improves continuously and globally — in much the same way a cup of tea improves continuously with biscuits nearby.

> **Fortune cookie.** *A ship in harbour is safe, but that is not what ships are built for. A CPU core left idle, however, is simply a waste of electricity.*

---

## 3. How to navigate the repository on GitHub

When you first open the repository, the top-level structure is laid out like a well-organised admiralty chart:

```
battleships-rl/
├── README.md              # this university-level tutorial (formerly TUTORIAL.md)
├── README2.md             # one-page project overview
├── PRETRAINING.md         # offline PyTorch DQN pipeline
├── ai_policy.json         # optional seed policy (generated artefact)
├── docs/
│   ├── ARCHITECTURE.md    # component diagram, data model, API, costs
│   ├── HISTORY.md         # why the architecture changed over time
│   └── DEBUG_LOG.md       # bugs encountered and how they were resolved
├── web/                   # React + Vite frontend
│   ├── src/
│   │   ├── App.jsx        # main component
│   │   ├── utils.js       # game logic + AI helpers
│   │   ├── training.worker.js
│   │   ├── training.config.js
│   │   ├── constants.js
│   │   ├── config.js
│   │   ├── hooks/
│   │   │   ├── useAudio.js
│   │   │   ├── useVoiceovers.js
│   │   │   ├── useTraining.js
│   │   │   └── useMobile.js
│   │   └── components/
│   │       ├── GameGrid.jsx
│   │       ├── InfoPanel.jsx
│   │       ├── Header.jsx
│   │       └── StatusBar.jsx
│   ├── index.html
│   └── package.json
├── worker/                # Cloudflare Worker backend
│   ├── index.js
│   ├── wrangler.toml
│   └── schema.sql
└── admin/                 # test harness
    ├── run-tests.mjs
    └── lib/harness.mjs
```

**A useful reading order:** start with `README2.md` for the one-page project overview, then read `docs/ARCHITECTURE.md` and `docs/HISTORY.md`. After that, dive into `web/src/App.jsx`, `web/src/utils.js`, `web/src/training.worker.js`, and `worker/index.js`. Should you read `ai_policy.json` from cover to cover, please seek help.

---

## 4. Core programming ideas

### 4.1. State machines drive the game

`App.jsx` holds the authoritative game state. The variable `gamePhase` is one of `placement`, `playing` or `gameOver`. Every user action transitions the machine from one phase to another. Keeping game state in one place, and representing the phase with an explicit enum rather than a loose collection of booleans, makes the logic easier to reason about and test.

> **Admiralty note.** You could implement the phase with a series of booleans named `isPlacing`, `isPlaying`, `hasEnded`, and `isDrinkingTea`. You would regret it.

### 4.2. React state and re-renders

React applications are built from components. Components re-render when their state or props change. `App.jsx` uses `useState` for values that should trigger a UI update: `playerGrid`, `computerGrid`, `isPlayerTurn`, `winner`, `consoleLog`.

Because React re-renders on every state change, it is important not to put heavy or frequently changing values in `useState` unless they affect the UI. The computer's move counter and voiceover scheduling are stored in `useRef`, because they are needed by event handlers but do not need to trigger re-renders. Think of `useRef` as the pocket of your coat: useful, discreet, and not something you wave about in front of guests.

### 4.3. Custom hooks separate concerns

A custom hook is a JavaScript function whose name starts with `use` and which calls other hooks. It is the standard React pattern for extracting stateful logic so it can be reused and tested separately from the presentation code.

The project has four small hooks:

- `useAudio` — plays intro and sound effects, respects the sound toggle.
- `useVoiceovers` — chooses and stops voiceover clips for the different humour levels.
- `useTraining` — owns the Web Worker lifecycle and schedules training batches.
- `useMobile` — detects whether the viewport is narrow, presumably because someone has a very small periscope.

Each hook does one job. This keeps `App.jsx` focused on orchestrating the game rather than on audio, speech, worker management, and responsive layout.

### 4.4. Immutability and helper functions

The grid is an array of arrays. Instead of mutating the grid directly, the code creates a new copy whenever a ship is placed or a shot is fired. This is a common React pattern: it makes state changes predictable and allows React to compare old and new objects efficiently. It also prevents the unpleasant business of one component accidentally sinking a ship another component was rather fond of.

The heavy lifting lives in `utils.js`, which exports pure helper functions such as `createEmptyGrid`, `isValidPlacement`, `processAttack` and `checkWinCondition`. These functions take data in, compute a result, and return new data, without touching React state directly.

### 4.5. Background work with a Web Worker

JavaScript in the browser is single-threaded. If the computer played 250 self-play games synchronously in `App.jsx`, the UI would freeze for several seconds. The grid would lock up, the animations would die, and the user would wonder whether the browser had gone down with all hands.

A Web Worker solves this by running a script in a separate thread. `useTraining` creates the worker, posts the current `weightMap` and `placementMemory` to it, and receives a delta back. The main thread stays free to animate the grid and respond to clicks. This is the classic *off-main-thread* architecture, beloved of engineers and anyone who has ever tried to make toast while also holding a conversation.

### 4.6. Client-server edge architecture

A traditional server lives in one data centre, quietly doing its job and presumably drinking bad coffee. A Cloudflare Worker runs in hundreds of data centres at the network edge. When the browser makes a request, the request is handled by the nearest edge location, giving very low latency.

The project separates concerns:

- The browser stores no secrets. It sends `X-API-Key` with POST requests.
- The Worker holds the real API key, D1 database and KV namespace via *bindings*.
- Bindings are direct, in-process references. They do not travel over the public internet, and they keep credentials off the client. In other words, the combination to the safe is never written on the safe.

### 4.7. Reinforcement learning as a lookup table

A neural-network DQN could choose shots, but the project uses a simpler and faster idea: a lookup table of `(board_key, coordinate) -> win_rate`.

The Web Worker plays thousands of games. Each time it fires a shot, it records the 100-character board key and the coordinate. If the shooter wins, every recorded shot is credited with a win. After many games, each `(key, coordinate)` pair has a `wins / samples` ratio. The highest-ratio coordinate for a given key is the recommended shot.

This is called **Monte Carlo policy evaluation**: the computer tries actions, counts outcomes, and preferentially repeats actions that led to victory. It is not as powerful as deep reinforcement learning, but it is explainable, fast, and easy to update in a browser. Deep learning may win chess; Battleship, it turns out, can often be sorted out with a spreadsheet and a bit of optimism.

---

## 5. Frontend walkthrough

### 5.1. `App.jsx` — the orchestrator

`App.jsx` is the root component. It:

1. Imports helper functions from `utils.js`.
2. Creates state for both grids, turn order, game phase, audio, voiceovers, training and console logs.
3. Handles ship placement, attack clicks, computer moves and game-over resets.
4. Renders `Header`, `StatusBar`, `GameGrid` components and the `InfoPanel` tactical console.

The core event flow is:

- Player clicks a cell in `GameGrid`.
- `handlePlayerAttack` validates the move, updates `playerGrid` and `computerGrid`, checks for a win, then calls `handleComputerAttack`.
- `handleComputerAttack` decides where the computer fires, using `getAiMove`. It then updates state and ends the turn.

> **Computer's diary.** *11:00 — Player clicked. 11:00 — I considered my options. 11:00 — I fired. It was, as these things go, an extremely small moment in the history of naval warfare.*

### 5.2. `utils.js` — game logic and AI

`utils.js` is where the rules of Battleship live. Key functions include:

- `createEmptyGrid()` — returns a 10×10 array of empty cells.
- `isValidPlacement(grid, ship, row, col, orientation)` — checks bounds and overlap.
- `placeShipsRandomlyWithTracking` — randomly positions all ships for the computer or a self-play opponent.
- `processAttack(grid, shipPositions, row, col)` — applies a shot and returns whether it was a hit, plus any sunk ships.
- `checkWinCondition(grid)` — true when all ship cells are hit.

#### 5.2.1. `getBoardKey`

The computer needs a compact representation of the board. `getBoardKey` builds a 100-character string from the current state:

```javascript
export const getBoardKey = (computerMoves, playerShipPositions, playerSunkShips) => {
  const grid = Array(GRID_SIZE).fill(null).map(() => Array(GRID_SIZE).fill(0));
  for (const move of computerMoves) {
    const { row, col } = move;
    if (!move.hit) grid[row][col] = 1;
    else {
      const isSunk = playerSunkShips.some(name => {
        const ship = playerShipPositions.find(s => s.name === name);
        return ship && ship.positions.some(pos => pos.row === row && pos.col === col);
      });
      grid[row][col] = isSunk ? 3 : 2;
    }
  }
  return grid.flat().join('');
};
```

Each character is `0` (unknown), `1` (miss), `2` (hit but not yet sunk), or `3` (sunk). This string becomes the key in the `weight_map` lookup table. A 100-character key may seem excessive for a humble board game, but then so is a full military orchestra for a commercial about plastic ships.

#### 5.2.2. `getAiMove`

`getAiMove` looks up the best shot for the current board. It tries, in order:

1. **Exact match** in `weightMap`.
2. **`empty_board`** policy for mostly-unknown boards.
3. **Closest known state** within a small Hamming distance.
4. **Checkerboard fallback** for the search phase.

```javascript
export const getAiMove = (boardKey, aiPolicy, computerMoves) => {
  if (!aiPolicy) return null;
  let recommendations = aiPolicy[boardKey];
  // ... empty_board and closest lookups ...
  if (!recommendations || recommendations.length === 0) {
    const fallback = getCheckerboardMove(boardKey);
    if (!fallback) return null;
    return { ...fallback, source: 'checkerboard', key: 'checkerboard' };
  }
  // ... pick first unattacked recommendation ...
};
```

The checkerboard fallback is a hardcoded heuristic. Because every ship is at least two cells long, every ship touches both checkerboard colours. Firing on one colour is therefore guaranteed to find every ship, so the only states that need to be learned are the exceptions where the AI has evidence that a different cell is better.

> **Fortune cookie.** *When in doubt, trust the checkerboard. All ships are at least two squares long, and two squares cannot hide from both colours. It is the geometry of despair.*

#### 5.2.3. `mergeWeightDelta`

When the Web Worker returns a delta, `mergeWeightDelta` merges it into the existing `weightMap`:

```javascript
export const mergeWeightDelta = (weightMap, delta) => {
  const next = { ...weightMap };
  for (const [key, actions] of Object.entries(delta)) {
    const existing = next[key] ? [...next[key]] : [];
    for (const [row, col, dWins, dSamples] of actions) {
      const idx = existing.findIndex(a => a[0] === row && a[1] === col);
      if (idx >= 0) {
        const [, , win, wins, samples] = existing[idx];
        const newWins = wins + dWins;
        const newSamples = samples + dSamples;
        existing[idx] = [row, col, newWins / newSamples, newWins, newSamples];
      } else {
        existing.push([row, col, dWins / dSamples, dWins, dSamples]);
      }
    }
    next[key] = existing;
  }
  return next;
};
```

This is incremental learning: add new wins and samples, recompute the ratio, and keep the highest-rated actions per state. It is, in essence, a very small and well-organised naval census.

### 5.3. `training.worker.js` — learning without freezing the UI

The worker is a separate JavaScript file that the browser runs in a background thread. It cannot touch the DOM or React state; it communicates only through `postMessage`. It is like a cabin boy below deck — busy, essential, and not allowed on the bridge.

The worker:

1. Receives `weightMap` and `placementMemory` from the main thread.
2. Plays a batch of self-play games (default 250).
3. For every shot, builds the board key and records the coordinate fired.
4. Expands each recorded key into all seven symmetric variants (rotations and reflections). This multiplies the effective training data by eight.
5. If the shooter wins, credits every recorded shot and its symmetric variants with a win.
6. Returns a compact `delta` object of `{ board_key: [[row, col, wins, samples], ...] }`.

The use of symmetry is a classic data-augmentation trick. Because a Battleship board has no preferred orientation, a lesson learned from one angle applies to all eight orientations. It is the software equivalent of trying every possible chair at the table before deciding where to sit.

### 5.4. `useTraining.js` — worker lifecycle

`useTraining` hides the worker mechanics from `App.jsx`. It:

- Creates the worker once on mount.
- Keeps refs to the latest `weightMap` and `placementMemory` so the worker always receives current data.
- Schedules the next training batch after each completion.
- Terminates the worker on unmount to avoid memory leaks.

This pattern — encapsulating an imperative browser API inside a declarative hook — is the idiomatic React way to manage timers, workers, sockets and other non-React resources. It is also, coincidentally, the correct way to manage a tea timer.

### 5.5. `InfoPanel.jsx` and `GameGrid.jsx`

`GameGrid` renders the 10×10 grid and turns clicks into function calls supplied by `App.jsx`. It receives callbacks like `onCellClick` and renders each cell's state visually. It does not, on its own, decide who wins. It merely reports.

`InfoPanel` is the Computer Tactical Console. It receives props for the computer's current thinking, combat statistics, training log, heatmap data and humour level, and renders them in a panel. It is a *presentational* component: it owns almost no state of its own, only display logic. It is, in short, the naval officer who reads the map but does not move the ships.

### 5.6. Audio and voiceovers

`useAudio` and `useVoiceovers` are excellent examples of custom hooks that wrap browser APIs. They each:

- Create an `Audio` object.
- Provide play/stop functions.
- Respect the `soundOn` state.
- Clean up on unmount.

`useVoiceovers` additionally chooses a random clip per personality and tracks scheduling, keeping the voiceover logic out of the main game loop. This prevents the computer from delivering a stirring monologue while the player is trying to aim.

---

## 6. Backend walkthrough

### 6.1. `worker/index.js` — the edge API

The Cloudflare Worker is the only place where D1 and KV credentials exist. It exposes a small API surface:

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/weight-map` | GET | Return the current `weight_map` from KV |
| `/api/top-layouts` | GET | Return the best human ship layouts from D1 |
| `/api/stats` | GET | Return counts of human/synthetic games and states |
| `/api/record` | POST | Save a finished human game to D1 |
| `/api/merge-weights` | POST | Merge a training delta into KV |

The Worker enforces:

- **CORS**: `isAllowedOrigin` checks the `Origin` header against `ALLOWED_ORIGINS`.
- **Authentication**: `checkApiKey` compares the `X-API-Key` header to the secret using `crypto.subtle.timingSafeEqual`. This prevents timing attacks that could leak the key length. A naïve string comparison, by contrast, is the cryptographic equivalent of leaving your front door ajar.
- **Rate limiting**: `rateLimitAllowed` uses D1 to count POST requests per IP in 60-second windows.
- **Input validation**: `validateLayout` and `validateDelta` reject malformed JSON, oversized payloads and invalid coordinates before any database write.

> **Admiralty warning.** The browser never sees `API_KEY`. That is a job for the Worker, the safe, and whichever member of the crew still remembers the combination.

### 6.2. D1 schema

```sql
CREATE TABLE IF NOT EXISTS layouts (
  layout_json TEXT PRIMARY KEY,
  wins INTEGER DEFAULT 0,
  games INTEGER DEFAULT 0,
  win_rate REAL DEFAULT 0.0,
  last_played INTEGER
);

CREATE TABLE IF NOT EXISTS rate_limits (
  ip TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (ip, window_start)
);
```

`layouts` stores human placement patterns and their win/loss records. `rate_limits` keeps per-IP request counts in time windows so limits are consistent across all edge locations. D1 was chosen because it is SQLite at the edge: fast reads, simple relational data, and a generous free tier. It also sounds reassuringly like the first movement of a symphony, if you listen closely enough.

### 6.3. KV `weight_map`

KV is a global key-value store. It is ideal for the `weight_map` because:

- It is replicated around the world, so reads are fast from any location.
- It can store values up to 25 MB, which comfortably holds the JSON lookup table.
- Writes are comparatively cheap, and the Worker merges deltas rather than rewriting the whole map every time.

The trade-off is eventual consistency: a newly uploaded `weight_map` may take a few moments to propagate globally. This is the digital equivalent of sending a message by semaphore: fast, but do not expect instant unanimity across the entire fleet.

---

## 7. Design choices and why they were made

### 7.1. Why React + Vite + Tailwind?

- **React** makes state-driven UI explicit and composable.
- **Vite** provides fast local development and an optimised production build.
- **Tailwind CSS** lets the UI be styled with utility classes in the JSX, keeping components and their styling colocated.

Together they make the frontend pleasant to edit, which is important, because a miserable frontend developer produces a miserable frontend.

### 7.2. Why GitHub Pages for hosting?

GitHub Pages is free for public repositories and works with Vite builds. Because the frontend is a static React app, no server-side rendering is required. The only drama is whether the deployment finishes before the kettle boils.

### 7.3. Why a Cloudflare Worker instead of a traditional backend?

A Worker runs at the edge, scales automatically, and costs little or nothing for hobby traffic. It also keeps credentials and database access out of the browser. A traditional backend, by comparison, sits in one place, requires maintenance, and occasionally has opinions about tea breaks.

### 7.4. Why in-browser training?

Training the model in the browser uses free CPU cycles on the player's device. Only a compact delta is uploaded, so Cloudflare egress and compute costs stay low. The Web Worker keeps the UI responsive while this happens. It is distributed computing by politely borrowing resources that would otherwise be spent on scrolling.

### 7.5. Why a lookup table instead of a neural network?

A neural network would need a runtime such as ONNX.js or TensorFlow.js, and it would be slower and harder to explain. A lookup table is:

- Fast: a JavaScript object lookup in milliseconds.
- Interpretable: the console can show exactly which state and coordinate were chosen.
- Easy to merge: new experience is added as win/sample deltas.

Deep learning may win at chess, but Battleship can often be resolved with a sufficiently large notebook and a trust in statistics.

### 7.6. Why the checkerboard fallback?

The checkerboard fallback hardcodes a provably sound search strategy. It removes the need to store thousands of obvious states in the policy file. Only states where the learned move is better than the parity heuristic need to be retained. It is the fallback of a player who has read the rules and decided that two squares long is quite enough to justify a system.

### 7.7. Why personality and voiceovers?

The project is inspired by a theatrical 1975 Milton Bradley commercial. The computer's personality and fortune-cookie asides turn a dry AI into a character, making the game more memorable and fun. A silent computer would still sink ships, but it would not do so with any style.

---

## 8. Best practices demonstrated

| Practice | Where it appears |
|---|---|
| **Secrets stay on the server** | `API_KEY` is a Worker secret; `.dev.vars` and `.env` files are gitignored. |
| **Timing-safe comparison** | `crypto.subtle.timingSafeEqual` in `checkApiKey`. |
| **CORS allow-list** | `isAllowedOrigin` checks against `ALLOWED_ORIGINS`. |
| **Rate limiting** | D1-backed `rate_limits` table. |
| **Input validation** | `validateLayout`, `validateDelta`, `MAX_DELTA_*` bounds. |
| **Custom hooks for side effects** | `useAudio`, `useVoiceovers`, `useTraining`. |
| **Off-main-thread work** | `training.worker.js` runs self-play in a Web Worker. |
| **Immutability** | `utils.js` returns new grids instead of mutating old ones. |
| **Pure helper functions** | Game logic is separated from React state in `utils.js`. |
| **Data augmentation** | Symmetry transforms in the worker multiply training examples. |
| **Documentation** | README, architecture, history and debug logs are all committed. |

> **Admiralty citation.** Following these practices will not guarantee victory at sea, but it will guarantee that defeat is well-documented.

---

## 9. Running, testing and deploying

### 9.1. Local development

```bash
cd web
npm install
npm run dev        # starts Vite on localhost:5173

cd ../worker
npm install
wrangler dev       # starts the Worker locally
```

For the Worker to have a local D1 database, you may need to create the tables with:

```bash
wrangler d1 execute battleship-rl-db --local --file=./schema.sql
```

> **A note on local development.** The first time you run `wrangler dev`, expect it to take slightly longer than making a proper cup of tea. Subsequent runs are faster.

### 9.2. Testing

The `admin/` directory contains a test harness that hits the API and checks game logic. It is run with:

```bash
cd admin
npm test
```

The harness starts the Worker locally, runs a batch of synthetic games, and verifies that endpoints behave correctly. Should you break the build, console yourself with the thought that every bug makes the eventual victory sweeter.

### 9.3. Deployment

```bash
cd web
npm run deploy      # builds and pushes to GitHub Pages

cd ../worker
npx wrangler deploy
```

The frontend and Worker are deployed independently. The frontend points to the Worker URL configured in `web/.env`.

---

## 10. Discussion questions and exercises

1. **State machine.** Trace `gamePhase` through one complete game. What are the transitions? Why is an enum preferable to a set of booleans?
2. **Custom hooks.** Pick one of the hooks in `web/src/hooks/`. What would `App.jsx` look like if that logic were inlined?
3. **Security.** Why does `checkApiKey` use `timingSafeEqual` instead of `===`?
4. **Worker communication.** The Web Worker cannot modify React state directly. How does `useTraining` get the result back to `App.jsx`?
5. **Data augmentation.** The worker generates seven symmetric variants of each board state. Why does this effectively multiply data by eight rather than seven?
6. **Cost engineering.** Look at `training.config.js`. What is the difference between `COST_FIRST` and `EXPERIENCE_FIRST`?
7. **Lookup vs. neural.** What are three reasons the authors chose a tabular policy over a neural network for the browser?
8. **Checkerboard correctness.** Explain why a checkerboard search is guaranteed to find every ship on a 10×10 board with ships of length 2 or more.
9. **Git navigation.** If you want to understand why the `getAiMove` function has a checkerboard fallback, which documentation files should you read? Which commit messages?
10. **Extending the project.** Add a "Fast Learner" training preset that trades even more cost for faster updates. What constants would you change in `training.config.js`, and what risks would that introduce?

---

## 11. Further reading

- **React custom hooks:** "Reusing Logic with Custom Hooks" — react.dev.
- **Web Workers:** "Using Web Workers" — MDN Web Docs.
- **Cloudflare Workers best practices:** "Workers Best Practices" — developers.cloudflare.com.
- **Reinforcement learning basics:** "Reinforcement Learning: An Introduction" — Sutton and Barto, Chapter 5 (Monte Carlo methods).
- **Original inspiration:** Milton Bradley *Battleship* television commercial, 1975.

---

## 12. Summary

`battleships-rl` is a compact but complete example of modern edge-AI engineering. It shows how to keep a game responsive by moving heavy simulation into a Web Worker, how to share learning globally with a Cloudflare Worker, and how to keep a project maintainable by separating game logic from React components. The design choices are driven by a clear ranking of priorities: player experience, low cost, elegance and continuous self-improvement.

The codebase is intentionally readable. Start with the docs, follow the state machine in `App.jsx`, trace a shot through `utils.js`, and watch how the Web Worker turns practice games into a learning delta. Every major decision is documented, and every security-sensitive detail is handled on the server side.

> **Final fortune cookie.** *You will soon discover that the ocean is mostly water, that the computer has been learning while you read this, and that a well-placed destroyer is worth two on the grid. Good luck, Admiral.*
