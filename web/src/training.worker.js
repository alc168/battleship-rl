import {
  createEmptyGrid,
  placeShipsRandomlyWithTracking,
  processAttack,
  checkWinCondition,
  checkSunkShips,
  getBoardKey,
  getAiMove,
  getRandomPosition,
  applyPlacementPattern,
  getTopPlacementPatterns
} from './utils.js';
import { CONFIG } from './training.config.js';

function selectPattern(placementMemory) {
  if (!placementMemory || placementMemory.length === 0) return null;
  const top = getTopPlacementPatterns(placementMemory, 3);
  const entry = top[Math.floor(Math.random() * top.length)];
  return entry?.pattern || null;
}

function buildDelta(games, weightMap, placementMemory) {
  const delta = {};

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
    const opponentGrid = oppResult.grid;
    const opponentShips = oppResult.shipPositions;

    const shooterMoves = [];
    const opponentMoves = [];
    const trace = [];
    let shooterWon = false;

    while (true) {
      const opponentSunkShips = checkSunkShips(opponentShips, shooterMoves);
      const boardKey = getBoardKey(shooterMoves, opponentShips, opponentSunkShips);
      let action = getAiMove(boardKey, weightMap, shooterMoves);

      if (!action) {
        do {
          action = getRandomPosition();
        } while (shooterMoves.some(m => m.row === action.row && m.col === action.col));
      }

      trace.push({ boardKey, row: action.row, col: action.col });
      const res = processAttack(opponentGrid, action.row, action.col);
      shooterMoves.push({ row: action.row, col: action.col, hit: res.hit });

      if (checkWinCondition(res.grid)) {
        shooterWon = true;
        break;
      }

      let oppAction;
      do {
        oppAction = getRandomPosition();
      } while (opponentMoves.some(m => m.row === oppAction.row && m.col === oppAction.col));
      const oppRes = processAttack(shooterGrid, oppAction.row, oppAction.col);
      opponentMoves.push({ row: oppAction.row, col: oppAction.col, hit: oppRes.hit });

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
    }
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

self.onmessage = (event) => {
  const { weightMap, placementMemory } = event.data;
  console.log('Training worker starting', CONFIG.GAMES_PER_BATCH, 'games');
  const start = performance.now();

  try {
    const delta = buildDelta(CONFIG.GAMES_PER_BATCH, weightMap, placementMemory);
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
