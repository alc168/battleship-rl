# Battleships RL — Code, Security and Robustness Review Report

**Date:** 2026-07-26  
**Scope:** `web/`, `worker/`, `admin/`, and all existing project `.md` files  
**Reviewers:** Devin, assisted by the `workers-best-practices` and `cloudflare` skills  

---

## 1. Executive Summary

I re-examined the Battleships RL codebase, ran the build, lint and the full 36-test admin harness, and reviewed the architecture, AI, and computer-thinking documents that already exist in the repository. The game is in good shape: it builds cleanly, passes all tests, and the recent component/hook refactor has made `App.jsx` much easier to follow.

During this review I made four concrete improvements aimed at robustness and security:

1. **Made the training hook teardown-safe** — `useTraining` now clears its pending `setTimeout` and terminates the worker cleanly on unmount.
2. **Replaced the in-memory rate limiter with D1** — rate limits are now consistent across all Cloudflare edge locations instead of being isolated to a single Worker process.
3. **Hardened API-key comparison** — the Worker now uses `crypto.subtle.timingSafeEqual` to avoid timing side-channels.
4. **Fixed lint warnings and a byte-size check** — removed unused variables, corrected the delta payload size check to measure bytes, and got `oxlint` to zero warnings.

All changes were deployed to the live Worker and all 36 admin tests now pass reliably.

---

## 2. How the Review Was Carried Out

- **Code inspection:** `web/src/App.jsx`, `web/src/utils.js`, `web/src/training.worker.js`, `web/src/hooks/*.js`, `web/src/components/*.jsx`, `worker/index.js`, `worker/schema.sql`, `admin/lib/harness.mjs`, `admin/tests/*.mjs`.
- **Documentation review:** `ARCHITECTURE.md`, `BRIEFING.md`, `BRIEFING_AI_IMPROVEMENTS.md`, `BRIEFING_COMPUTER_THINKING.md`, `PROJECT_REVIEW.md`.
- **Skill consultation:** `workers-best-practices` and `cloudflare` for Cloudflare-specific security, anti-patterns and limits.
- **Tooling:** `npm run build`, `npx oxlint`, `node run-tests.mjs`.
- **Deployment:** `wrangler deploy` to propagate the Worker security fixes.

---

## 3. Current State

### 3.1 Build, lint and tests

| Check | Result |
|---|---|
| `npm run build` (web) | Pass |
| `npx oxlint src` | 0 warnings, 0 errors |
| `node run-tests.mjs` (admin) | 36/36 pass |
| Live Worker deployment | Successful |

### 3.2 Architecture health

The architecture described in `ARCHITECTURE.md` and `BRIEFING.md` remains sound for the project's constraints:

- **Fast gameplay:** all move decisions happen in the browser after an initial download, so there is no network latency during a turn.
- **Cheap operation:** static hosting on GitHub Pages, serverless Cloudflare Worker, D1 and KV free tiers, batch uploads of training deltas.
- **Continuous learning:** a Web Worker self-plays 250-game batches; the resulting delta is merged locally and uploaded to KV for the next player.
- **Shared memory:** D1 stores human ship layouts; KV stores the shooting policy.

The component/hook refactor from the previous session has removed the worst of the monolithic `App.jsx`:

- `Header`, `StatusBar`, `GameGrid`, `InfoPanel` are now standalone components.
- `useAudio`, `useMobile`, and `useTraining` own their own lifecycle.

The game-state logic still lives in `App.jsx`. This is acceptable for a small application but should be the next extraction target.

### 3.3 AI state

`BRIEFING_AI_IMPROVEMENTS.md` and `BRIEFING_COMPUTER_THINKING.md` accurately describe the AI's strengths and weaknesses:

- **Strengths:** exact-key lookup, empty-board policy, nearest-state Hamming-distance fallback, symmetry augmentation, richer action lists (20 per state), humour dial and thinking narration.
- **Weaknesses:** the tabular policy is still sparse; a single changed cell creates a new 100-character key; the AI does not yet learn from real human games.

These are not bugs — they are documented design trade-offs. The most impactful next improvement would be online learning from real games.

---

## 4. Findings and Fixes Applied

### 4.1 Training hook teardown (`web/src/hooks/useTraining.js`)

**Finding:** `useTraining` scheduled a `setTimeout` but did not clear it on unmount, and it did not cancel the timeout if the component was destroyed before the worker fired up. This could lead to stale timers posting to a terminated worker.

**Fix:** Added a `timeoutRef`, cleared any pending timeout before scheduling a new one, and cleared it in the cleanup function. The worker is now terminated cleanly and no stale `setTimeout` callbacks run after unmount.

### 4.2 In-memory rate limiter (`worker/index.js`)

**Finding:** The original `RateLimiter` was a module-level `Map`. In Cloudflare Workers this is **not** shared across all edge locations or even all isolates in the same location. It only counted requests that happened to hit the exact same Worker process. The admin rate-limit test was therefore flaky: it would pass when requests stayed in one isolate and fail when they were distributed.

**Fix:** Replaced the in-memory `Map` with a D1-backed rate-limit table:

```sql
CREATE TABLE IF NOT EXISTS rate_limits (
  ip TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (ip, window_start)
);
```

Each POST now reads/writes the per-IP counter to D1. The table was added to `worker/schema.sql` and applied to the live database with `wrangler d1 execute`.

### 4.3 API-key timing attack (`worker/index.js`)

**Finding:** `checkApiKey` used a direct string comparison (`provided === env.API_KEY`). This can leak information through timing side-channels.

**Fix:** Replaced it with `crypto.subtle.timingSafeEqual` over `Uint8Array` encodings of the provided key and the secret. The check is now `async` and is `await`ed in both `/api/record` and `/api/merge-weights`.

### 4.4 Delta payload size check (`worker/index.js`)

**Finding:** `validateDelta` measured `JSON.stringify(delta).length`, which counts characters, not bytes. For a limit of 2 MiB this could under-count multi-byte characters.

**Fix:** Now uses `new TextEncoder().encode(JSON.stringify(delta)).length` to measure the actual byte size of the serialized payload.

### 4.5 Lint and dead code (`web/src/utils.js`, `web/src/App.jsx`, `web/src/training.worker.js`)

- Removed unused `emptyKey` from `getAiMove`.
- Removed unused `CELL_STATES` import from `App.jsx`.
- Removed unused `shooterShips` variable from `training.worker.js`.

After these changes `npx oxlint src` reports zero warnings.

---

## 5. Perspectives from the Existing Markdown Files

The existing documents were consistent and useful:

- **`ARCHITECTURE.md`** recommended the current hybrid-edge pattern (React + Worker + D1 + KV) and listed alternatives. The implementation matches this recommendation.
- **`BRIEFING.md`** gives a clear, non-technical explanation of the data flow and learning algorithm. It remains accurate after the refactor.
- **`BRIEFING_AI_IMPROVEMENTS.md`** explains why the AI falls back to random and lists concrete improvements. Nearest-state lookup and symmetry augmentation are already implemented; online learning and Wilson scoring are still pending.
- **`BRIEFING_COMPUTER_THINKING.md`** documents the humour dial, fortune cookies, and hunt-logic fix. These features are preserved in the refactored components.
- **`PROJECT_REVIEW.md`** identified code organisation, type safety, testing, accessibility, mobile UX, performance and DevOps gaps. The component/hook refactor directly addresses the code organisation section, and the D1 rate limiter addresses a security/robustness gap.

---

## 6. Remaining Recommendations and Enhancements

These are ordered by the project's stated priorities: gameplay first, then cost, elegance/efficiency, and self-learning.

### 6.1 Gameplay experience

1. **Online learning from real games**  
   The biggest remaining gap. Record the actual move trace from each human game and merge a delta into the weight map. This directly reduces the mismatch between self-play training and live human opponents.

2. **Smarter action ranking**  
   Replace raw `wins / samples` with a Wilson score lower bound or UCB score. This keeps rarely-seen actions available while penalising weak evidence.

3. **Improved hunt targeting**  
   Add parity-based search, ship-size constraints, and a "known ship cannot fit here" filter to reduce wasted shots.

4. **Mobile UX**  
   - Move the console toggle to a sticky bottom bar or floating action button (thumb zone).
   - Increase touch targets to at least 48×48 px.
   - Convert the console to a bottom-sheet/drawer on mobile.
   - Add a PWA manifest and service worker for offline play.

### 6.2 Cost and performance

1. **Shard the weight map in KV**  
   As the policy grows, a single `weight_map` key will approach KV's 25 MiB value limit. Split by board-state prefix or move large snapshots to R2 with incremental diffs.

2. **Cache the weight map client-side**  
   Store it in `IndexedDB` and only refetch when a server version/ETag changes. This reduces bandwidth and KV read costs.

3. **Compress audio assets**  
   Convert MP3s to Ogg/Opus for smaller files without quality loss.

### 6.3 Elegance, efficiency and maintainability

1. **Extract a `useGameState` reducer or store**  
   The game-state logic and handlers still occupy a large portion of `App.jsx`. Moving them into a custom hook or reducer would improve testability and readability.

2. **Add TypeScript**  
   Type safety is the single biggest maintainability improvement for a small effort. It would catch shape errors in the AI data structures and API contracts.

3. **Add frontend unit tests**  
   Vitest + React Testing Library for `utils.js`, the hooks, and the presentational components would complement the existing 36 admin tests.

4. **Accessibility**  
   - Add `aria-live` regions for console/log updates.
   - Replace colour-only heatmap communication with labels/screen-reader text.
   - Add text alternatives for emoji status markers.
   - Manage focus when the console opens and closes.

### 6.4 Self-learning

1. **Exploration/exploitation schedule**  
   Start with more random exploration and gradually become greedier, so the AI discovers new states while still exploiting known good moves.

2. **Function approximation**  
   When the tabular approach can no longer scale, train a small neural network (TensorFlow.js or ONNX) on self-play and real-game data. This removes the exact-key limitation entirely.

3. **Curriculum training**  
   Train against progressively stronger opponents rather than purely random placements.

---

## 7. Conclusion

The Battleships RL project is now more robust and secure than before. The build is clean, lint passes, all 36 tests pass reliably, and the live Worker has been updated with the D1-backed rate limiter and timing-safe API-key comparison. The architecture remains well-suited to the priorities of fast gameplay, low cost, and continuous learning.

The highest-value next steps are:

1. Learn from real human games.
2. Extract the remaining game state from `App.jsx` into a dedicated hook or reducer.
3. Add TypeScript and frontend tests.
4. Improve mobile UX and PWA support.

These changes would move the project from a polished demo to a genuinely excellent, self-improving game experience.
