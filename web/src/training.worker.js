import {
  createEmptyGrid,
  placeShipsRandomlyWithTracking,
  processAttack,
  checkWinCondition,
  checkSunkShips,
  getBoardKey,
  getAiMove,
  applyPlacementPattern,
  getTopPlacementPatterns
} from './utils.js';
import { GRID_SIZE } from './constants.js';
import { CONFIG } from './training.config.js';

const MAX_MOVES_PER_GAME = 200;

const N = GRID_SIZE;

// Symmetry transforms for the 10×10 board key and (row,col) coordinates.
// Each returns a new key string and a new action coordinate so that the same
// tactical recommendation can be learned from eight equivalent viewpoints.
function idxToCoord(i) {
  return { row: Math.floor(i / N), col: i % N };
}

function coordToIdx(row, col) {
  return row * N + col;
}

function transformKey(key, transform) {
  const out = new Array(key.length).fill('0');
  for (let i = 0; i < key.length; i++) {
    const { row, col } = idxToCoord(i);
    const t = transform(row, col);
    out[coordToIdx(t.row, t.col)] = key[i];
  }
  return out.join('');
}

const transforms = [
  { name: 'identity',    f: (r, c) => ({ row: r, col: c }) },
  { name: 'rot90',       f: (r, c) => ({ row: c, col: N - 1 - r }) },
  { name: 'rot180',      f: (r, c) => ({ row: N - 1 - r, col: N - 1 - c }) },
  { name: 'rot270',      f: (r, c) => ({ row: N - 1 - c, col: r }) },
  { name: 'flipH',       f: (r, c) => ({ row: N - 1 - r, col: c }) },
  { name: 'flipV',       f: (r, c) => ({ row: r, col: N - 1 - c }) },
  { name: 'transpose',   f: (r, c) => ({ row: c, col: r }) },
  { name: 'antiDiag',    f: (r, c) => ({ row: N - 1 - c, col: N - 1 - r }) }
];

function getUnattackedMove(moves) {
  const used = new Set(moves.map(m => `${m.row},${m.col}`));
  const available = [];
  for (let r = 0; r < GRID_SIZE; r++) {
    for (let c = 0; c < GRID_SIZE; c++) {
      if (!used.has(`${r},${c}`)) available.push({ row: r, col: c });
    }
  }
  if (available.length === 0) return null;
  return available[Math.floor(Math.random() * available.length)];
}

function selectPattern(placementMemory) {
  if (!placementMemory || placementMemory.length === 0) return null;
  const top = getTopPlacementPatterns(placementMemory, 3);
  const entry = top[Math.floor(Math.random() * top.length)];
  return entry?.pattern || null;
}

async function buildDelta(games, weightMap, placementMemory) {
  const delta = {};
  let abortedGames = 0;

  for (let g = 0; g < games; g++) {
    // Shooter (policy side) ships
    const pattern = selectPattern(placementMemory);
    let shooterGrid;
    let shooterShips;
    if (pattern) {
      const result = applyPlacementPattern(pattern);
      shooterGrid = result.grid;
      shooterShips = result.shipPositions;
    } else {
      const result = placeShipsRandomlyWithTracking(createEmptyGrid());
      shooterGrid = result.grid;
      shooterShips = result.shipPositions;
    }

    // Opponent ships
    const oppResult = placeShipsRandomlyWithTracking(createEmptyGrid());
    let opponentGrid = oppResult.grid;
    const opponentShips = oppResult.shipPositions;

    const shooterMoves = [];
    const opponentMoves = [];
    const trace = [];
    let shooterWon = false;
    let moveCount = 0;

    while (true) {
      if (++moveCount > MAX_MOVES_PER_GAME) {
        abortedGames++;
        shooterWon = false;
        break;
      }

      if (checkWinCondition(opponentGrid)) {
        shooterWon = true;
        break;
      }

      const opponentSunkShips = checkSunkShips(opponentShips, shooterMoves);
      const boardKey = getBoardKey(shooterMoves, opponentShips, opponentSunkShips);
      let action = getAiMove(boardKey, weightMap, shooterMoves);

      if (!action) {
        action = getUnattackedMove(shooterMoves);
      }

      if (!action) {
        abortedGames++;
        shooterWon = false;
        break;
      }

      // Augment with all 7 symmetric variants plus identity. This multiplies
      // effective training data by 8 without playing extra games.
      for (const t of transforms) {
        trace.push({
          boardKey: transformKey(boardKey, t.f),
          row: t.f(action.row, action.col).row,
          col: t.f(action.row, action.col).col
        });
      }

      const res = processAttack(opponentGrid, action.row, action.col);
      shooterMoves.push({ row: action.row, col: action.col, hit: res.hit });
      opponentGrid = res.grid;

      if (checkWinCondition(res.grid)) {
        shooterWon = true;
        break;
      }

      if (checkWinCondition(shooterGrid)) {
        shooterWon = false;
        break;
      }

      let oppAction = getUnattackedMove(opponentMoves);
      if (!oppAction) {
        abortedGames++;
        shooterWon = true;
        break;
      }
      const oppRes = processAttack(shooterGrid, oppAction.row, oppAction.col);
      opponentMoves.push({ row: oppAction.row, col: oppAction.col, hit: oppRes.hit });
      shooterGrid = oppRes.grid;

      if (checkWinCondition(oppRes.grid)) {
        shooterWon = false;
        break;
      }
    }

    for (const t of trace) {
      if (!delta[t.boardKey]) delta[t.boardKey] = {};
      const k = `${t.row},${t.col}`;
      if (!delta[t.boardKey][k]) {
        delta[t.boardKey][k] = { row: t.row, col: t.col, wins: 0, samples: 0 };
      }
      delta[t.boardKey][k].samples += 1;
      if (shooterWon) delta[t.boardKey][k].wins += 1;
    }

    if ((g + 1) % CONFIG.CHUNK_SIZE === 0) {
      self.postMessage({ type: 'progress', completed: g + 1, total: games });
      // Yield the event loop so progress messages are delivered to the main thread live
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  }

  if (abortedGames > 0) {
    console.warn('Training aborted', abortedGames, 'of', games, 'games as draws');
  }

  // Convert to compact array format and prune before sending
  const result = {};
  for (const [stateKey, actionsObj] of Object.entries(delta)) {
    const actions = Object.values(actionsObj)
      .map(v => [v.row, v.col, v.wins, v.samples])
      .filter(v => v[3] >= CONFIG.MIN_SAMPLES_PER_ACTION)
      .sort((a, b) => (b[2] / b[3]) - (a[2] / a[3]))
      .slice(0, CONFIG.MAX_ACTIONS_PER_STATE);

    if (actions.length) {
      result[stateKey] = actions;
    }
  }

  return result;
}

self.onmessage = async (event) => {
  const { weightMap, placementMemory } = event.data;
  console.log('Training worker starting', CONFIG.GAMES_PER_BATCH, 'games');
  const start = performance.now();

  try {
    const delta = await buildDelta(CONFIG.GAMES_PER_BATCH, weightMap, placementMemory);
    const elapsed = performance.now() - start;

    self.postMessage({
      type: 'complete',
      delta,
      completed: CONFIG.GAMES_PER_BATCH,
      elapsed
    });
  } catch (err) {
    console.error('Training worker failed:', err);
    self.postMessage({
      type: 'error',
      error: err.message || String(err)
    });
  }
};
