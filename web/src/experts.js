import { GRID_SIZE, SHIPS } from './constants.js';
import {
  getAiMove,
  getCheckerboardMove,
  getHuntDirectionTargets,
  isCellOfSunkShip
} from './utils.js';

const inBounds = (row, col) => row >= 0 && row < GRID_SIZE && col >= 0 && col < GRID_SIZE;
const boardIndex = (row, col) => row * GRID_SIZE + col;

const UNKNOWN = '0';
const MISS = '1';
const HIT = '2';
const SUNK = '3';

/**
 * DQN / Teacher expert.
 * When the sparse policy has a known or near-state, it proposes the move the
 * Q-values recommend, using the stored win-rate as its score.
 */
function dqnExpert(boardKey, weightMap, computerMoves) {
  const valueMap = new Float32Array(GRID_SIZE * GRID_SIZE);
  const aiMove = getAiMove(boardKey, weightMap, computerMoves);
  if (!aiMove) return { valueMap, source: null, winRate: 0, chosenRecommendation: null };

  const policyRecommendations = weightMap ? weightMap[aiMove.key] : [];
  const chosen = policyRecommendations?.find(r => r[0] === aiMove.row && r[1] === aiMove.col) || null;
  const winRate = chosen ? chosen[2] : 0;

  valueMap[boardIndex(aiMove.row, aiMove.col)] = winRate;
  return { valueMap, source: aiMove.source, winRate, chosenRecommendation: chosen };
}

/**
 * Hunt expert.
 * When there are known unsunk hits, continue along the line. If a queued target
 * list exists, use the first valid one from that queue.
 */
function huntExpert(boardKey, computerMoves, playerShipPositions, playerSunkShips, computerHuntTargets) {
  const valueMap = new Float32Array(GRID_SIZE * GRID_SIZE);

  const validTargets = computerHuntTargets.filter(target =>
    inBounds(target.row, target.col) &&
    !computerMoves.some(move => move.row === target.row && move.col === target.col)
  );

  if (validTargets.length > 0) {
    validTargets.forEach((target, i) => {
      valueMap[boardIndex(target.row, target.col)] = 1.0 - i * 0.01;
    });
    return { valueMap, source: 'hunt' };
  }

  const recentHits = computerMoves.filter(move =>
    move.hit && !isCellOfSunkShip(move.row, move.col, playerShipPositions, playerSunkShips)
  );

  if (recentHits.length > 0) {
    const lastHit = recentHits[recentHits.length - 1];
    const targets = getHuntDirectionTargets(
      lastHit.row,
      lastHit.col,
      computerMoves,
      playerShipPositions,
      playerSunkShips
    ).filter(t => !computerMoves.some(move => move.row === t.row && move.col === t.col));

    targets.forEach((target, i) => {
      valueMap[boardIndex(target.row, target.col)] = 0.95 - i * 0.01;
    });
  }

  return { valueMap, source: 'hunt' };
}

/**
 * Probability-density expert.
 * Enumerates every valid placement of the remaining ships and counts how many
 * pass through each unknown cell. Valid placements:
 *   - Do not overlap known misses (1) or sunk cells (3).
 *   - Do not touch (in any of the 8 surrounding cells) a known hit/sunk cell
 *     unless that neighbour is part of the same placement. This enforces the
 *     "ships do not touch" assumption.
 * A mild coverage discount is applied so the AI prefers less-searched areas
 * when probabilities are otherwise equal.
 */
function probabilityExpert(boardKey, playerSunkShips, computerMoves) {
  const remainingShips = SHIPS.filter(ship => !playerSunkShips.includes(ship.name));
  const counts = new Float64Array(GRID_SIZE * GRID_SIZE);
  const valueMap = new Float32Array(GRID_SIZE * GRID_SIZE);

  const localShots = new Int8Array(GRID_SIZE * GRID_SIZE);
  for (const move of (computerMoves || [])) {
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        const r = move.row + dr;
        const c = move.col + dc;
        if (inBounds(r, c)) localShots[boardIndex(r, c)]++;
      }
    }
  }

  for (const ship of remainingShips) {
    for (let row = 0; row < GRID_SIZE; row++) {
      for (let col = 0; col < GRID_SIZE; col++) {
        for (const orientation of ['horizontal', 'vertical']) {
          if (orientation === 'horizontal' && col + ship.size > GRID_SIZE) continue;
          if (orientation === 'vertical' && row + ship.size > GRID_SIZE) continue;

          const cells = [];
          let valid = true;

          for (let i = 0; i < ship.size; i++) {
            const r = orientation === 'horizontal' ? row : row + i;
            const c = orientation === 'horizontal' ? col + i : col;
            const ch = boardKey[boardIndex(r, c)];
            if (ch === MISS || ch === SUNK) {
              valid = false;
              break;
            }
            cells.push({ r, c });
          }

          if (!valid) continue;

          const cellSet = new Set(cells.map(({ r, c }) => `${r},${c}`));

          for (const { r, c } of cells) {
            for (let dr = -1; dr <= 1; dr++) {
              for (let dc = -1; dc <= 1; dc++) {
                if (dr === 0 && dc === 0) continue;
                const nr = r + dr;
                const nc = c + dc;
                if (!inBounds(nr, nc)) continue;
                if (cellSet.has(`${nr},${nc}`)) continue;

                const nch = boardKey[boardIndex(nr, nc)];
                if (nch === HIT || nch === SUNK) {
                  valid = false;
                  break;
                }
              }
              if (!valid) break;
            }
            if (!valid) break;
          }

          if (!valid) continue;

          for (const { r, c } of cells) {
            const i = boardIndex(r, c);
            if (boardKey[i] === UNKNOWN) counts[i]++;
          }
        }
      }
    }
  }

  let maxCount = 0;
  for (let i = 0; i < counts.length; i++) {
    if (counts[i] > maxCount) maxCount = counts[i];
  }
  if (maxCount === 0) maxCount = 1;

  for (let i = 0; i < valueMap.length; i++) {
    if (boardKey[i] === UNKNOWN) {
      const p = counts[i] / maxCount;
      const discount = 1 / (1 + localShots[i] * 0.5);
      valueMap[i] = p * discount;
    }
  }

  return { valueMap, source: 'probability' };
}

/**
 * Coverage expert.
 * When no strong signal exists, nudge the AI toward the least-explored
 * 3×3 neighbourhood. This is intentionally a low-magnitude signal so it acts
 * as a tie-breaker rather than overriding probability.
 */
function coverageExpert(computerMoves) {
  const valueMap = new Float32Array(GRID_SIZE * GRID_SIZE);
  const localShots = new Int8Array(GRID_SIZE * GRID_SIZE);

  for (const move of (computerMoves || [])) {
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        const r = move.row + dr;
        const c = move.col + dc;
        if (inBounds(r, c)) localShots[boardIndex(r, c)]++;
      }
    }
  }

  for (let i = 0; i < valueMap.length; i++) {
    valueMap[i] = 0.15 / (1 + localShots[i]);
  }

  return { valueMap, source: 'coverage' };
}

/**
 * Checkerboard parity expert.
 * Pure parity fallback when every other signal is flat.
 */
function checkerboardExpert(boardKey) {
  const valueMap = new Float32Array(GRID_SIZE * GRID_SIZE);
  const move = getCheckerboardMove(boardKey);
  if (move) {
    valueMap[boardIndex(move.row, move.col)] = 0.05;
  }
  return { valueMap, source: 'checkerboard' };
}

/**
 * Ensemble move selector.
 * Each expert produces a 100-cell value map. The experts are processed in
 * priority order (hunt → dqn → probability → coverage → checkerboard), and
 * the highest-scoring unknown cell wins. The value map is also returned so
 * the tactical console can display the same heat the AI actually used.
 */
export const getEnsembleMove = ({
  boardKey,
  weightMap,
  computerMoves,
  playerShipPositions,
  playerSunkShips,
  computerHuntTargets
}) => {
  const experts = [
    huntExpert(boardKey, computerMoves, playerShipPositions, playerSunkShips, computerHuntTargets),
    dqnExpert(boardKey, weightMap, computerMoves),
    probabilityExpert(boardKey, playerSunkShips, computerMoves),
    coverageExpert(computerMoves),
    checkerboardExpert(boardKey)
  ];

  const combined = new Float32Array(GRID_SIZE * GRID_SIZE);
  const sources = new Array(GRID_SIZE * GRID_SIZE).fill(null);

  for (const expert of experts) {
    for (let i = 0; i < expert.valueMap.length; i++) {
      if (expert.valueMap[i] > combined[i]) {
        combined[i] = expert.valueMap[i];
        sources[i] = expert.source;
      }
    }
  }

  let bestIndex = -1;
  let bestValue = -Infinity;
  for (let i = 0; i < combined.length; i++) {
    if (boardKey[i] !== UNKNOWN) continue;
    if (combined[i] > bestValue) {
      bestValue = combined[i];
      bestIndex = i;
    }
  }

  if (bestIndex === -1) return null;

  const row = Math.floor(bestIndex / GRID_SIZE);
  const col = bestIndex % GRID_SIZE;
  const source = sources[bestIndex];
  const dqn = experts[1];

  return {
    row,
    col,
    source,
    valueMap: Array.from(combined),
    winRate: source === dqn.source ? dqn.winRate : 0,
    chosenRecommendation: source === dqn.source ? dqn.chosenRecommendation : null,
    topActions: getTopActions(combined, boardKey)
  };
};

function getTopActions(valueMap, boardKey) {
  const entries = [];
  for (let i = 0; i < valueMap.length; i++) {
    if (boardKey[i] === UNKNOWN) {
      entries.push({
        row: Math.floor(i / GRID_SIZE),
        col: i % GRID_SIZE,
        value: valueMap[i],
        samples: 0
      });
    }
  }
  entries.sort((a, b) => b.value - a.value);
  return entries.slice(0, 5);
}
