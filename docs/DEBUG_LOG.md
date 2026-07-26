# Battleships RL — Debug Log

A concise record of the major bugs encountered during development, the situation in which they appeared, and the resolution applied.

---

## 1. Blank deployed page

| Field | Description |
|---|---|
| **Situation** | After deploying the React app to GitHub Pages, the live page was blank. Local dev worked correctly. |
| **Bug** | `App.jsx` used `renderShipIcon` in the ship legend, but the function was only defined locally inside `GameGrid.jsx`. At runtime this caused `ReferenceError: renderShipIcon is not defined`, which prevented React from rendering. |
| **Resolution** | Moved `renderShipIcon` to module scope in `App.jsx` so it was available to both the legend and the `GameGrid` component. Rebuilt and redeployed. |

---

## 2. `human_games` counter stayed at zero

| Field | Description |
|---|---|
| **Situation** | The Computer Tactical Console showed `Human games: 0` even after finished games. The backend `api/stats` endpoint returned positive counts, so data existed on the server. |
| **Bug** | The deployed front-end bundle was built without `VITE_API_BASE_URL` and `VITE_API_KEY`. All API calls were going to `http://localhost:8787` and failing, so `fetchStats` never updated the UI and `/api/record` never reached the Worker. |
| **Resolution** | Created `web/.env` with the live API URL and a matching API key, added a production fallback in `config.js`, and rebuilt and redeployed. API errors are now also logged to the tactical console. |

---

## 3. Cloudflare KV daily write-limit warning

| Field | Description |
|---|---|
| **Situation** | Cloudflare reported that the Worker was hitting 50% of the daily KV write limit after short play sessions. |
| **Bug** | The training loop uploaded the weight-map delta after every single 250-game batch and ran a batch every 5 seconds. `POST /api/merge-weights` performs two KV writes per call, so the system was writing every few seconds. |
| **Resolution** | Batched uploads: accumulate deltas locally and flush to `/api/merge-weights` only every `UPLOAD_INTERVAL_BATCHES` batches. Changed `COST_FIRST` to `UPLOAD_INTERVAL_BATCHES: 10` and `CONTINUOUS_INTERVAL_MS: 30000`, reducing writes to roughly one every 300 seconds. |

---

## 4. Flaky per-IP rate limiting

| Field | Description |
|---|---|
| **Situation** | The rate-limit test in the admin harness passed intermittently. Sometimes requests from the same IP were not rate-limited. |
| **Bug** | The original `RateLimiter` was an in-memory `Map` inside the Worker script. Cloudflare Workers run in many isolates across edge locations, so the map was not shared between requests. |
| **Resolution** | Replaced the in-memory `Map` with a D1 `rate_limits` table. Every POST now reads and writes the per-IP counter to D1, giving consistent rate limits across all edge locations. |

---

## 5. Delta payload size under-counted

| Field | Description |
|---|---|
| **Situation** | Reviewing `validateDelta` showed that the 2 MiB payload check could be bypassed by multi-byte characters. |
| **Bug** | The code measured `JSON.stringify(delta).length`, which counts characters, not bytes. Multi-byte UTF-8 characters would make the actual payload larger than the limit allowed. |
| **Resolution** | Changed the check to `new TextEncoder().encode(JSON.stringify(delta)).length`, which measures the true serialized byte size. |

---

## 6. Training hook left stale timers on unmount

| Field | Description |
|---|---|
| **Situation** | `useTraining` scheduled a `setTimeout` to start the worker, but it did not clean it up when the component unmounted. |
| **Bug** | A pending `setTimeout` could fire and post to a terminated worker after the component was destroyed, leading to console warnings and possible race conditions. |
| **Resolution** | Added a `timeoutRef`, cleared any pending timeout before scheduling a new one, and cleared it in the cleanup function. The worker is now terminated cleanly on unmount. |

---

## 7. `getAiMove` returned unused `emptyKey`

| Field | Description |
|---|---|
| **Situation** | Static linting reported an unused variable in `getAiMove`. |
| **Bug** | `emptyKey` was computed but never used, leftover from an earlier iteration of the fallback logic. |
| **Resolution** | Removed `emptyKey` from `getAiMove` and `oxlint` now reports zero warnings on `web/src`. |

---

## 8. Game-over banner blocked the final board layout

| Field | Description |
|---|---|
| **Situation** | Users wanted to inspect the final board after a win or loss, but the victory/defeat banner was fixed in the center of the screen. |
| **Bug** | The banner was not interactive; it could not be moved out of the way. |
| **Resolution** | Added drag handling (mouse and touch) to the banner. It now stores an offset and updates it as the user drags. Drag starts on the `NEW MISSION` button are ignored so the button still works. |

---

## 9. Mobile placement instruction mentioned unavailable keyboard shortcuts

| Field | Description |
|---|---|
| **Situation** | On mobile devices the prompt said "R to rotate" and "Enter to randomize", even though mobile users do not have those keyboard shortcuts. |
| **Bug** | The placement instruction was the same for all viewports. |
| **Resolution** | Conditionally rendered the instruction: on mobile it now reads "Place ships in Friendly Waters"; on desktop it retains the keyboard shortcuts. |

---

## 10. CORS allowed `localhost` in production

| Field | Description |
|---|---|
| **Situation** | `wrangler.toml` listed `http://localhost:5173` in `ALLOWED_ORIGINS` for the production Worker. |
| **Bug** | A production endpoint that trusts `localhost` allows arbitrary local development clients to call the live API. |
| **Resolution** | Recommended removal of `localhost` from the production `ALLOWED_ORIGINS`; it can be overridden locally via `.dev.vars` or `wrangler dev` configuration. This change is pending explicit environment cleanup. |
