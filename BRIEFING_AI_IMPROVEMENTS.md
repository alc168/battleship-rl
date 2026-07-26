# Battleships - RL — Why the AI falls back to random and how to improve it

**Date:** 2026-07-26  
**Version:** 1.0a  
**Scope:** RL policy lookup, state-space sparsity, and tactical-console feedback

---

## 1. Executive summary

The computer player frequently falls back to *random* shots because the learned policy is asked about board states it has never seen before. The current system stores an exact 100-character `boardKey` for every state it has encountered; with only 500 self-play games per batch, the vast majority of possible states are unvisited. This briefing explains the root causes and lists concrete code modifications — some already implemented, some recommended for a future release — that reduce the fallback rate and make the tactical console more informative.

---

## 2. How the current policy lookup works

The AI uses a tabular value function:

1. `getBoardKey(computerMoves, playerShipPositions, playerSunkShips)` returns a 100-character string where each character encodes one cell (`0` = unknown, `1` = miss, `2` = hit, `3` = sunk).
2. `getAiMove(boardKey, weightMap, computerMoves)` looks up that exact string in `weightMap` (loaded from Cloudflare KV).
3. If a matching key exists, the function returns the highest win-rate unshot cell from the stored action list.
4. If no match exists — or if all stored actions for that state have already been fired — `getAiMove` returns `null` and `handleComputerAttack` falls back to random fire.

The stored `weightMap` is built by a Web Worker that self-plays batches of Battleship, merges the resulting deltas, and uploads them to KV.

---

## 3. Root causes of the "no policy for this state" fallback

### 3.1 State-space explosion

A 10×10 board with four possible cell states has a theoretical key space of `4^100` (≈ 1.6 × 10^60). Even with the constraints of the game, the number of *reachable* states is still enormous. A batch of 500 self-play games visits only a tiny fraction of those states, so almost any unique pattern of misses and hits is unseen.

### 3.2 Exact-key matching

`getAiMove` requires the `boardKey` to match a key in `weightMap` exactly. Changing one cell (e.g., a single miss at a new location) creates a completely new 100-character key, even though the tactical situation is very similar to a known state.

### 3.3 Action sparsity per state

Originally only 5–8 actions were retained for each known state (`MAX_ACTIONS_PER_STATE` = 5 for `COST_FIRST`, 8 for `EXPERIENCE_FIRST`). After the computer fires at those few recommended cells, the next move for the same state has no remaining unshot action and again falls back to random.

### 3.4 Minimum-sample filtering

`mergeWeights` in `worker/index.js` discards any action with fewer than 3 samples. With small batches, many useful but rarely-seen actions are pruned before they can ever be recommended.

### 3.5 Training/evaluation distribution mismatch

The worker trains by self-play against random human-like placements. A real human player tends to create different board patterns, so the exact states encountered during a live game may not be the same ones the worker has visited.

---

## 4. Code modifications already made

The following changes are committed to `main` and deployed:

### 4.1 `web/src/utils.js` — nearest-state generalisation

- Added `getClosestBoardKey(query, aiPolicy, maxDistance)` which finds the stored key with the smallest Hamming distance to the current `boardKey`.
- Added `countKnownCells(boardKey)` helper.
- Updated `getAiMove` to:
  1. Try an exact match first.
  2. Fall back to `aiPolicy['empty_board']` when the board has 4 or fewer known cells and no exact match.
  3. Fall back to the closest known state if it is within a Hamming distance of 6.

This immediately reduces random fallbacks because the AI can now reuse policies from visually similar states.

### 4.2 `web/src/training.config.js` — richer action lists

- `COST_FIRST.MAX_ACTIONS_PER_STATE` increased from 5 to 20.
- `COST_FIRST.MIN_SAMPLES_PER_ACTION` reduced from 10 to 3.
- `EXPERIENCE_FIRST.MAX_ACTIONS_PER_STATE` increased from 8 to 20.

### 4.3 `worker/index.js` — accept and store larger policies

- `MAX_DELTA_ACTIONS_PER_STATE` raised from 10 to 20.
- `mergeWeights.MAX_ACTIONS` raised from 8 to 20.

These changes allow the worker to upload and the server to store more candidate cells per known state, reducing the chance that all stored actions for a state are already attacked.

### 4.4 `web/src/App.jsx` — tactical console open by default

- The **Computer Tactical Console** now opens by default (`showInfoPanel` defaults to `true`).
- The corner icon is now a text toggle: **"Computer Tactical Console"** / **"Close Console"**.
- The heatmap shows a probability number in every square, changes colour from cyan (low) to red (high), and preserves the historical probability on already-fired cells.

---

## 5. Recommended further improvements

### 5.1 Online learning from real games

The current pipeline learns entirely from self-play. Recording the *real* board states and final outcomes of live games would let the worker prioritise the exact states a human opponent produces. Implementation:

- At game end, collect `computerMoves`, `playerShipPositions`, and `winner`.
- Build a small delta of the states visited during that game and the final reward (+1 for a computer win, -1 for a loss).
- `POST` this delta to a new endpoint such as `/api/learn-from-game` and merge it with `weightMap`.
- This is one of the most reliable ways to reduce the mismatch between training and live play.

### 5.2 Larger and more frequent training batches

- Increase `GAMES_PER_BATCH` from 500 to 2,000–5,000, or run the worker on a schedule in the background.
- Consider `CONTINUOUS_INTERVAL_MS` values below 2,000 ms when the player is idle to populate more states faster.
- Trade-off: more KV writes and CPU usage. Use `EXPERIENCE_FIRST` on desktop and `COST_FIRST` on mobile.

### 5.3 Lower the minimum-sample threshold with Bayesian smoothing

Change `MIN_SAMPLES_PER_ACTION` and `mergeWeights.MIN_SAMPLES` to `1`, but rank actions by a lower-confidence bound rather than raw win rate:

```js
// Wilson score lower bound
function wilsonLower(wins, samples, z = 1.0) {
  const p = wins / samples;
  const n = samples;
  const zz = z * z;
  const denom = 1 + zz / n;
  const centre = p + zz / (2 * n);
  const width = z * Math.sqrt((p * (1 - p) + zz / (4 * n)) / n);
  return (centre - width) / denom;
}
```

Use this score for sorting. It keeps rarely-seen actions available while penalising those with weak evidence.

### 5.4 Symmetry and rotation augmentation

Battleship has symmetries: rotating or reflecting a board does not change the underlying value. Before storing a board state, generate its 7 symmetric variants and store the same action recommendations for all of them. This multiplies effective training data by 8 without extra games.

### 5.5 Function approximation (neural net)

For a dramatically larger improvement, replace the exact tabular map with a small neural network such as a multi-layer perceptron or a tiny CNN in TensorFlow.js:

- Input: a 10×10×4 one-hot board state.
- Output: a 100-element vector of estimated win probabilities per cell.
- Train the network offline on a large batch of self-play data, then use it for live inference.

This requires the most engineering but removes the exact-key limitation entirely.

### 5.6 Cached, compressed policy snapshots

Instead of reading the entire `weightMap` on every page load, store monthly/daily snapshots and let the browser fetch incremental updates. This allows much larger maps without increasing bandwidth.

---

## 6. Conclusion

The random fallback is a symptom of an extremely sparse tabular policy. The changes already deployed (nearest-state lookup, richer action lists, and an open tactical console) give an immediate, visible improvement. The next biggest gains will come from (1) learning directly from live human games, (2) lowering the sample threshold with proper confidence scoring, and (3) eventually moving from an exact-key table to a generalising function approximator.
