# Battleships RL — Debug Log

A concise record of the major bugs, errors, and usability issues encountered across the Battleships RL project. Each entry describes the situation, the bug, and the resolution. Timestamps for the web app are taken from `git log` (AEST, +10:00); DQN/Colab timestamps are approximate because the conversation export does not store per-message times.

---

## DQN / Colab training session

### 2026-07-26 ~10:11 — `GITHUB_TOKEN` not available in Colab

| Field | Description |
|---|---|
| **Situation** | A Python runner script tried to read `GITHUB_TOKEN` from Colab secrets to push `ai_policy.json` to GitHub. |
| **Bug** | `RuntimeError: GITHUB_TOKEN is not set` was raised because the secret toggle in the Colab secrets panel was off. |
| **Resolution** | Advised enabling the toggle next to `GITHUB_TOKEN` in the Colab secrets panel, or temporarily setting the token via `os.environ` for quick tests. |

### 2026-07-26 ~10:11 — `!python` shell could not read Colab secrets

| Field | Description |
|---|---|
| **Situation** | A test cell could print the token, but `!python battleship_colab_runner.py` still failed. |
| **Bug** | `!python` runs in a separate shell process where `google.colab.userdata` is not importable, so the runner fell back to `os.environ`, which was empty. |
| **Resolution** | Ran the script with `%run` in the same IPython kernel so `google.colab.userdata` was accessible, or exported the token to the shell environment first. |

### 2026-07-26 ~10:11 — GitHub API 403 when creating a new repository

| Field | Description |
|---|---|
| **Situation** | The Colab runner attempted to create the `battleship-rl` repository automatically. |
| **Bug** | `POST /user/repos` returned `403 Resource not accessible by personal access token`. The token was fine-grained or lacked the `repo`/`public_repo` scope. |
| **Resolution** | Recommended creating the repository manually through the GitHub UI and rerunning, or regenerating the token with the correct `repo`/`public_repo` scope. |

### 2026-07-26 ~10:11 — Git checkout failed with HTTP 404

| Field | Description |
|---|---|
| **Situation** | The runner cloned the new repository and tried to check out `main` or `master`. |
| **Bug** | The repository was empty and had no `main` or `master` branch, or the script assumed a branch name that did not exist. |
| **Resolution** | Updated the clone/checkout logic to detect the default branch dynamically or to create the initial branch when the repository was empty. |

---

## Web app — initial build and deployment

### 2026-07-25 14:31:04 — Tailwind CSS not loading

| Field | Description |
|---|---|
| **Situation** | A Vite + React project was scaffolded, but the game board and UI appeared unstyled. |
| **Bug** | Tailwind CSS directives were not included or configured correctly, so utility classes had no effect. |
| **Resolution** | Fixed the Tailwind CSS import and PostCSS configuration in `src/index.css` and `postcss.config.js`. |

### 2026-07-25 14:31:04 — Vercel deployment failed

| Field | Description |
|---|---|
| **Situation** | The user requested public hosting on Vercel. |
| **Bug** | Vercel CLI authentication failed, blocking automated deployment. |
| **Resolution** | Switched the hosting target from Vercel to GitHub Pages and configured `gh-pages` for deployment. |

### 2026-07-25 14:57:16 — Ships not placing on the grid

| Field | Description |
|---|---|
| **Situation** | The player clicked the grid during placement, but ships did not appear. |
| **Bug** | The radar sweep overlay was intercepting pointer events and ship cells were behind it due to `z-index` issues. |
| **Resolution** | Set `pointer-events: none` and corrected `z-index` layering on the radar sweep so clicks reached the grid cells. |

### 2026-07-25 15:01:00 — Radar sweep interfering with debugging

| Field | Description |
|---|---|
| **Situation** | Ship placement was still intermittent after the first z-index fix, making it hard to tell whether the state or the rendering was wrong. |
| **Bug** | The animated radar sweep made visual debugging difficult. |
| **Resolution** | Temporarily removed the radar sweep and added console logging to confirm that the underlying state updates were correct. |

### 2026-07-25 15:02:25 — GitHub Pages homepage URL mismatch

| Field | Description |
|---|---|
| **Situation** | The GitHub Pages build succeeded, but assets failed to load. |
| **Bug** | The `homepage` field in `package.json` was missing a trailing slash, causing relative asset paths to resolve incorrectly. |
| **Resolution** | Updated `homepage` to include the trailing slash. |

### 2026-07-25 15:06:29 — GitHub Pages updates not reflecting

| Field | Description |
|---|---|
| **Situation** | New builds were pushed but the live site showed an older version. |
| **Bug** | GitHub Pages cached the old `dist/` content; fresh deployments were not immediately visible. |
| **Resolution** | Forced the `gh-pages` deployment with the `-f` flag to overwrite the published branch. |

### 2026-07-25 17:19:56 — Version counter not updating

| Field | Description |
|---|---|
| **Situation** | It was hard to tell whether the latest deployed build was live because the version was not visible. |
| **Bug** | No on-screen build version, so stale caches looked identical to new builds. |
| **Resolution** | Added a visible `APP_VERSION` constant in `constants.js` and displayed it in the header. |

### 2026-07-25 17:23:37 — React keys causing grid re-render issues

| Field | Description |
|---|---|
| **Situation** | Grid cells flickered or lost state during updates. |
| **Bug** | Grid cells were using non-unique or unstable `key` props, causing React to reconcile incorrectly. |
| **Resolution** | Improved React `key` generation for grid cells and ship status items. |

### 2026-07-25 17:31:24 — `placeShipWithTracking is not defined`

| Field | Description |
|---|---|
| **Situation** | The user clicked a grid cell to place a ship and nothing happened. |
| **Bug** | `ReferenceError: placeShipWithTracking is not defined` in `src/App.jsx` because the function was called without being imported. |
| **Resolution** | Added the missing `placeShipWithTracking` import from `utils.js`. |

---

## Web app — hit, sink, and AI logic

### 2026-07-25 20:55:10 — Sunk ship skulls appeared one turn late

| Field | Description |
|---|---|
| **Situation** | The final missile that sank a ship rendered as a normal red hit, and skulls only appeared on the next turn. |
| **Bug** | `checkSunkShips` was called with the old `playerMoves`/`computerMoves` array, before the latest hit had been added. State batching meant sunk detection happened on the next render. |
| **Resolution** | Built the updated moves array first, then passed that array (including the latest hit) to `checkSunkShips` so skulls rendered immediately. |

### 2026-07-25 20:55:10 — Last missile wrong colour on a sinking shot

| Field | Description |
|---|---|
| **Situation** | The last hit that sank a ship was styled with the red `hit-cell` background. |
| **Bug** | `getCellClass` applied the red hit style for any `move.hit` without first checking whether the cell belonged to a sunk ship. |
| **Resolution** | Added an `isCellOfSunkShip` helper and made `getCellClass` apply the dark `sunk-cell` style to sunk cells before falling back to `hit-cell`. |

### 2026-07-25 21:05:54 — Computer AI fired randomly after hits

| Field | Description |
|---|---|
| **Situation** | The computer was too easy to beat because it did not capitalise on hits. |
| **Bug** | `handleComputerAttack` always chose a random coordinate, ignoring previous successful hits. |
| **Resolution** | Added `computerHuntTargets` state and helpers (`getAdjacentCells`, `getHuntDirectionTargets`). After a hit the computer targets adjacent cells, and after two aligned hits it continues along the ship's axis until the ship sinks. |

### 2026-07-25 21:05:54 — No win/loss screen

| Field | Description |
|---|---|
| **Situation** | When the game ended, only the status bar text changed. |
| **Bug** | There was no clear end-of-game display. |
| **Resolution** | Added a win/loss modal, later converted to a non-blocking top banner so the final boards remain visible. |

### 2026-07-25 21:10:47 — Every grid square was glowing

| Field | Description |
|---|---|
| **Situation** | The radar sweep caused all cells to pulse, cluttering the view. |
| **Bug** | CSS targeted `.radar-grid > div:not(.radar-sweep)`, applying the glow to every cell. |
| **Resolution** | Replaced broad CSS targeting with explicit `radar-glow` and `radar-glow-sunk` classes, applied only to hit/miss/skull cells on the enemy grid. |

### 2026-07-25 21:21:04 — Victory modal hid the board

| Field | Description |
|---|---|
| **Situation** | The end-of-game modal used a full-screen overlay. |
| **Bug** | The overlay covered both grids, preventing the user from seeing the final state. |
| **Resolution** | Replaced the full-screen modal with a compact fixed banner at the top of the screen. Later made that banner draggable. |

---

## Web app — UI/UX and mobile polish

### 2026-07-25 21:36:00 — No on-screen instructions

| Field | Description |
|---|---|
| **Situation** | New users had no guidance on how to place ships or fire missiles. |
| **Bug** | The UI provided no prompts for placement controls or attack controls. |
| **Resolution** | Added a placement prompt (`R to rotate — Enter to randomize`) and a battle prompt (`Click any square to fire a missile`). Later shortened the placement prompt on mobile. |

### 2026-07-25 21:42:23 — No keyboard shortcuts for placement

| Field | Description |
|---|---|
| **Situation** | Users had to click the orientation button and had no quick random placement. |
| **Bug** | Only mouse interaction was supported for placement. |
| **Resolution** | Added a `keydown` listener: `R` rotates the current ship, `Enter` randomly places remaining ships and starts the game. |

### 2026-07-25 21:48:48 — Unhit enemy ships stayed hidden on defeat

| Field | Description |
|---|---|
| **Situation** | On a loss, only hits and misses were visible on the enemy grid. |
| **Bug** | Surviving enemy ship cells continued to render as empty water after the game ended. |
| **Resolution** | Updated `getCellClass` so that when `winner === 'computer'`, any enemy `CELL_STATES.SHIP` cell without a player move renders with `.enemy-ship-revealed` styling. |

### 2026-07-25 22:08:33 — Mobile layout squeezed grids side-by-side

| Field | Description |
|---|---|
| **Situation** | On narrow phone screens both grids were displayed horizontally, making them unusably small. |
| **Bug** | `.game-area` used a single row layout regardless of viewport. |
| **Resolution** | Made `.game-area` `flex-col-reverse` on small screens (enemy grid first) and `flex-row` on larger screens. Added a `RANDOM` button for mobile users and wrapped the random-placement handler in `useCallback`. |

### 2026-07-25 22:08:33 — useEffect re-registered keyboard listener every render

| Field | Description |
|---|---|
| **Situation** | The `R`/`Enter` listener was re-attached on every state update. |
| **Bug** | `handleRandomPlacement` was recreated each render, causing the `useEffect` to add and remove the `keydown` listener repeatedly. |
| **Resolution** | Wrapped `startGame` and `handleRandomPlacement` in `useCallback` with correct dependency arrays and imported `useCallback`. |

---

## Battleships RL — production hardening and live issues

### 2026-07-26 — Blank deployed page

| Field | Description |
|---|---|
| **Situation** | After deploying the React app to GitHub Pages, the live page was blank, although local development worked. |
| **Bug** | `App.jsx` used `renderShipIcon` in the ship legend, but the function was only defined locally inside `GameGrid.jsx`. At runtime this caused `ReferenceError: renderShipIcon is not defined`, which prevented React from rendering. |
| **Resolution** | Moved `renderShipIcon` to module scope in `App.jsx` so it was available to both the legend and `GameGrid`. Rebuilt and redeployed. |

### 2026-07-26 — `human_games` counter stayed at zero

| Field | Description |
|---|---|
| **Situation** | The Computer Tactical Console showed `Human games: 0` even after finished games. The backend `api/stats` endpoint already returned positive counts. |
| **Bug** | The deployed front-end bundle was built without `VITE_API_BASE_URL` and `VITE_API_KEY`. All API calls went to `http://localhost:8787` and failed, so `fetchStats` never updated the UI and `/api/record` never reached the Worker. |
| **Resolution** | Created `web/.env` with the live API URL and a matching API key, added a production fallback in `config.js`, and rebuilt and redeployed. API errors are now also logged to the tactical console. |

### 2026-07-26 — Cloudflare KV daily write-limit warning

| Field | Description |
|---|---|
| **Situation** | Cloudflare reported that the Worker was hitting 50% of the daily KV write limit after short play sessions. |
| **Bug** | The training loop uploaded the weight-map delta after every 250-game batch and ran a batch every 5 seconds. `POST /api/merge-weights` performs two KV writes per call. |
| **Resolution** | Batched uploads: accumulate deltas locally and flush to `/api/merge-weights` only every `UPLOAD_INTERVAL_BATCHES` batches. Changed `COST_FIRST` to `UPLOAD_INTERVAL_BATCHES: 10` and `CONTINUOUS_INTERVAL_MS: 30000`, reducing writes to roughly one every 300 seconds. |

### 2026-07-26 — Flaky per-IP rate limiting

| Field | Description |
|---|---|
| **Situation** | The rate-limit test in the admin harness passed intermittently. Sometimes requests from the same IP were not rate-limited. |
| **Bug** | The original `RateLimiter` was an in-memory `Map` inside the Worker script. Cloudflare Workers run in many isolates across edge locations, so the map was not shared between requests. |
| **Resolution** | Replaced the in-memory `Map` with a D1 `rate_limits` table. Every POST now reads and writes the per-IP counter to D1, giving consistent rate limits across all edge locations. |

### 2026-07-26 — Delta payload size under-counted

| Field | Description |
|---|---|
| **Situation** | Reviewing `validateDelta` showed that the 2 MiB payload check could be bypassed by multi-byte characters. |
| **Bug** | The code measured `JSON.stringify(delta).length`, which counts characters, not bytes. |
| **Resolution** | Changed the check to `new TextEncoder().encode(JSON.stringify(delta)).length`, which measures the true serialized byte size. |

### 2026-07-26 — Training hook left stale timers on unmount

| Field | Description |
|---|---|
| **Situation** | `useTraining` scheduled a `setTimeout` to start the worker, but it did not clean it up when the component unmounted. |
| **Bug** | A pending `setTimeout` could fire and post to a terminated worker after the component was destroyed. |
| **Resolution** | Added a `timeoutRef`, cleared any pending timeout before scheduling a new one, and cleared it in the cleanup function. The worker now terminates cleanly on unmount. |

### 2026-07-26 — `getAiMove` returned unused `emptyKey`

| Field | Description |
|---|---|
| **Situation** | Static linting reported an unused variable in `getAiMove`. |
| **Bug** | `emptyKey` was computed but never used, leftover from an earlier iteration of the fallback logic. |
| **Resolution** | Removed `emptyKey` from `getAiMove` and `oxlint` now reports zero warnings on `web/src`. |

### 2026-07-26 — Game-over banner blocked the final board layout

| Field | Description |
|---|---|
| **Situation** | Users wanted to inspect the final board after a win or loss, but the victory/defeat banner was fixed in the center of the screen. |
| **Bug** | The banner was not interactive and could not be moved out of the way. |
| **Resolution** | Added drag handling (mouse and touch) to the banner. It now stores an offset and updates it as the user drags. Drag starts on the `NEW MISSION` button are ignored so the button still works. |

### 2026-07-26 — Mobile placement instruction mentioned unavailable keyboard shortcuts

| Field | Description |
|---|---|
| **Situation** | On mobile devices the prompt said "R to rotate" and "Enter to randomize", even though mobile users do not have those keyboard shortcuts. |
| **Bug** | The placement instruction was the same for all viewports. |
| **Resolution** | Conditionally rendered the instruction: on mobile it now reads "Place ships in Friendly Waters"; on desktop it retains the keyboard shortcuts. |

### 2026-07-26 — CORS allowed `localhost` in production

| Field | Description |
|---|---|
| **Situation** | `wrangler.toml` listed `http://localhost:5173` in `ALLOWED_ORIGINS` for the production Worker. |
| **Bug** | A production endpoint that trusts `localhost` allows arbitrary local development clients to call the live API. |
| **Resolution** | Recommended removing `localhost` from the production `ALLOWED_ORIGINS`; it can be overridden locally via `.dev.vars` or `wrangler dev` configuration. This change is pending explicit environment cleanup. |

---

## Version roadmap (web app)

| Version | Timestamp (AEST) | Key fixes |
|---|---|---|
| v1.0.7 | 2026-07-25 17:19:56 | Version counter, state batching |
| v1.0.8 | 2026-07-25 17:23:37 | React keys, debug logging |
| v1.0.9 | 2026-07-25 17:31:24 | Missing `placeShipWithTracking` import |
| v1.0.10 | 2026-07-25 20:55:10 | Sunk ship detection and skull rendering |
| v1.1.0 | 2026-07-25 21:05:54 | Smart AI hunt, win screen, ship icons, radar |
| v1.1.1 | 2026-07-25 21:10:47 | Radar glow restricted to ships/skulls |
| v1.1.2 | 2026-07-25 21:15:17 | Enemy-waters-only glow |
| v1.1.3 | 2026-07-25 21:21:04 | Non-blocking victory banner |
| v1.1.4 | 2026-07-25 21:36:00 | On-screen instructions, README, lint |
| v1.1.5 | 2026-07-25 21:42:23 | Keyboard shortcuts for placement |
| v1.1.6 | 2026-07-25 21:48:48 | Reveal unhit enemy ships on defeat |
| v1.1.7 | 2026-07-25 22:08:33 | Mobile responsive layout and random button |
