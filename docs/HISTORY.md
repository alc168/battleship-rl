# Battleships RL — Architecture History

This document records how the architecture of `battleships-rl` evolved. It focuses on the key decisions and the trade-offs between **usability**, **cost**, **elegance**, and **fun** that shaped the current system.

---

## 1. Phase 1 — Static prototype (early 2024)

### What existed

- A pure React app hosted on GitHub Pages.
- A static `ai_policy.json` file bundled with the app.
- Placement memory stored in `localStorage`.
- The computer made every decision in the browser with no server.

### Decisions and trade-offs

| Driver | Decision |
|---|---|
| Cost | Zero server cost; no backend at all. |
| Usability | Instant moves because every lookup was in-memory. |
| Elegance | Very simple; no deployment complexity. |
| Fun | The game was playable, but the AI could not improve across sessions. |

### Outcome

This phase proved the gameplay loop, but it was not truly self-learning. Data was trapped in the user's browser and lost on cache clear.

---

## 2. Phase 2 — Cloudflare edge backend

### What changed

- A Cloudflare Worker was added as an API layer.
- Cloudflare D1 was introduced to store human ship layouts.
- Cloudflare KV was introduced to store the global weight map.
- Endpoints: `/api/weight-map`, `/api/top-layouts`, `/api/record`, `/api/merge-weights`, `/api/stats`.

### Decisions and trade-offs

| Driver | Decision |
|---|---|
| Usability | Still instant moves; the browser downloads the weight map once and then uses it in memory. |
| Cost | D1 and KV free tiers are generous for small scale; GitHub Pages remains free. |
| Elegance | Worker bindings hold secrets; the browser never sees credentials. |
| Fun | The computer can now learn from every player, making it feel smarter over time. |

### Outcome

The system became a shared, persistent learning platform. The architecture matched the "hybrid edge" pattern: static frontend + edge API + serverless storage.

---

## 3. Phase 3 — In-browser training

### What changed

- A Web Worker was added to run self-play games in the background.
- The worker plays 250-game batches by default.
- It records every `(board_key, coordinate)` pair and expands each state into seven symmetric variants.
- The browser merges the resulting delta locally, then uploads it to `/api/merge-weights`.

### Decisions and trade-offs

| Driver | Decision |
|---|---|
| Usability | Web Workers keep the UI responsive during heavy simulation. |
| Cost | Free CPU in the browser; only the final delta is uploaded. |
| Elegance | Training is client-side; the server only validates and merges. |
| Fun | Continuous improvement is visible in the tactical console and heatmap. |

### Outcome

The AI could train continuously while a human played. Symmetry augmentation multiplied effective data by eight without extra games.

---

## 4. Phase 4 — Smarter AI lookups

### What changed

- `getAiMove` was enhanced to fall back to the closest known state within a Hamming distance of 6.
- An `empty_board` policy was added for mostly empty boards.
- `MAX_ACTIONS_PER_STATE` was increased from 5 to 20 so more candidate cells were kept per state.
- `MIN_SAMPLES_PER_ACTION` was lowered from 10 to 3 to retain rarely-seen but useful actions.

### Decisions and trade-offs

| Driver | Decision |
|---|---|
| Usability | Fewer random fallbacks make the computer feel more competent. |
| Cost | Larger action lists and nearest-state search increase KV read size and CPU slightly, but remain within free limits. |
| Elegance | A tabular value function with three clean fallbacks: exact, empty-board, closest. |
| Fun | The "Current Thinking" panel explains which fallback was used, adding personality. |

### Outcome

Random shots became less frequent. The tactical console began to show whether the computer used an exact match, the empty-board policy, a nearest neighbour, hunt logic, or random fire.

---

## 5. Phase 5 — UI, personality, and mobile polish

### What changed

- A Computer Tactical Console was added with live training logs, combat statistics, a probability heatmap, and the computer's "thinking".
- A humour dial (Pragmatic, Wry, Cheeky, Philosophical) was added.
- Fortune-cookie asides were added at higher humour levels.
- Sound effects and mobile responsive layout were added.
- The console was made open by default on mobile.
- The victory/defeat banner was made draggable.

### Decisions and trade-offs

| Driver | Decision |
|---|---|
| Usability | The console is open by default so players can see why the computer acts. |
| Cost | Audio and CSS animations are client-side; no extra server usage. |
| Elegance | The sound effects pay homage to a 1975 Milton Bradley commercial, giving the game a cohesive theme. |
| Fun | The humour dial and fortunes turn a dry tactical display into an entertaining character. |

### Outcome

The game gained personality. Mobile layout placed enemy waters first, friendly waters second, and the full console below. The audio grounded the experience in a nostalgic naval-theatre tone.

---

## 6. Phase 6 — Cost and security hardening

### What changed

- Training uploads were throttled to one per ten batches with a 30-second interval in `COST_FIRST` mode.
- API-key authentication was added to all write endpoints.
- API-key comparison was hardened with `crypto.subtle.timingSafeEqual`.
- Per-IP rate limiting was moved from an in-memory `Map` to a D1-backed table.
- `validateDelta` was fixed to measure payload size in bytes, not string length.
- `VITE_API_BASE_URL` and `VITE_API_KEY` were required for the production build.

### Decisions and trade-offs

| Driver | Decision |
|---|---|
| Usability | Slower training cadence means the UI stays stable; the console still updates. |
| Cost | Throttling keeps KV writes under the free-tier 1,000/day limit. |
| Elegance | D1-backed rate limits are consistent across all Cloudflare edge locations, replacing a fragile in-memory map. |
| Fun | Security hardening does not affect gameplay. |

### Outcome

The system became production-safe for a hobby audience. `EXPERIENCE_FIRST` was kept as a paid-tier option.

---

## 7. Phase 7 — Expert ensemble and Web Audio (2026-08)

### What changed

- `web/src/experts.js` was created to combine five move-selection strategies:
  - **Hunt** — follows unsunk hits and continues along their axis.
  - **DQN** — exact match, `empty_board` and closest-known-state lookups from the learned `weight_map`.
  - **Probability density** — counts every legal placement of the remaining ships, weighted by the probability each ship is still alive.
  - **Coverage** — nudges the AI toward the least-shot 3×3 neighbourhood.
  - **Checkerboard** — a parity fallback of last resort.
- `getEnsembleMove` replaced `getAiMove`; the ensemble is consulted in priority order so a strong local signal can still dominate a weaker global one.
- `getAdjacentCells`, `isCellOfSunkShip` and `getHuntDirectionTargets` were moved from `App.jsx` into `utils.js` for reuse.
- `web/src/audio-engine.js` was added to manage all sound playback through a shared `AudioContext`, fixing autoplay blocking for the intro and voiceovers when triggered from `setTimeout`.
- The intro music was throttled to play on the 1st, 4th, 7th, etc. game run per tab to avoid wearing out the welcome.
- `handleComputerAttack` now clears `computerHuntTargets` as soon as a ship sinks, preventing wasted shots at an already-destroyed ship.
- `APP_VERSION` was bumped to `1.02`.

### Decisions and trade-offs

| Driver | Decision |
|---|---|
| Usability | The ensemble still makes instant moves but behaves more like a skilled human: it finishes wounded ships, trusts probability, and falls back to a sound parity search. |
| Cost | Probability and coverage experts run entirely in the browser; no extra backend calls. |
| Elegance | Each expert is a small, testable function; `getEnsembleMove` is a single orchestrator. |
| Fun | The tactical console now explains which expert (hunt, DQN, probability, coverage or checkerboard) chose the move, adding another layer of theatre. |

### Outcome

Random or wasteful shots became far rarer. The audio autoplay issues disappeared. The AI became more transparent, and the project gained a clean, extensible expert system that can accept new strategies without rewriting `App.jsx`.

---

## 8. Summary of key decisions

| Decision | Why it was made | Trade-off |
|---|---|---|
| Static GitHub Pages frontend | Fast, free, easy to deploy. | No server-side rendering or dynamic pages. |
| Cloudflare Worker API | Serverless edge API that holds secrets. | Workers free tier has a 100,000 request/day limit. |
| Cloudflare D1 for layouts | Relational storage for tabular win/loss data. | Queries can scan the table as it grows. |
| Cloudflare KV for weight map | Fast global reads for a JSON lookup table. | 25 MiB per-value limit and 1,000 writes/day. |
| In-browser Web Worker training | Uses free client CPU; keeps UI responsive. | Training data is only shared when uploaded. |
| Symmetry augmentation | 8x data multiplier without extra games. | Slightly larger upload payloads. |
| Nearest-state and empty-board fallbacks | Reduce random shots and make the AI feel smarter. | Slightly more KV data to download; later superseded by the expert ensemble. |
| Expert ensemble (DQN + probability + hunt + coverage + checkerboard) | Combine the best of learned and model-based reasoning. | More client-side CPU; gains may plateau on small sample sizes. |
| Tactical console with personality | Explain the AI and add fun. | Larger UI; open by default on mobile uses more screen. |
| `COST_FIRST` throttling | Stay inside free tiers. | Slower global model improvement. |
| Shared API key in the client bundle | Simplest possible auth for an unauthenticated public game. | Key can be extracted from the bundle; rotation is manual. |

---

## 8. Future directions

The next likely architectural moves are:

1. **Online learning from real games** — merge live game traces to reduce the self-play / human-play distribution mismatch.
2. **Confidence-based action ranking** — Wilson-score or UCB ranking to keep rare but promising actions.
3. **Weight-map sharding** — split the KV value by state prefix once it nears 25 MiB.
4. **Anonymous session cookies** — replace the shared client key with Turnstile-validated httpOnly session cookies.
