import { GRID_SIZE, CELL_STATES, SHIPS } from './constants.js';

export const createEmptyGrid = () => {
  return Array(GRID_SIZE).fill(null).map(() => 
    Array(GRID_SIZE).fill(CELL_STATES.EMPTY)
  );
};

export const isValidPlacement = (grid, ship, row, col, orientation) => {
  const { size } = ship;
  
  // Check if ship fits within grid bounds
  if (orientation === 'horizontal') {
    if (col + size > GRID_SIZE) {
      return false;
    }
  } else {
    if (row + size > GRID_SIZE) {
      return false;
    }
  }
  
  // Check for overlapping ships
  for (let i = 0; i < size; i++) {
    const checkRow = orientation === 'horizontal' ? row : row + i;
    const checkCol = orientation === 'horizontal' ? col + i : col;
    
    if (grid[checkRow][checkCol] !== CELL_STATES.EMPTY) {
      return false;
    }
  }
  
  return true;
};

export const placeShip = (grid, ship, row, col, orientation) => {
  const newGrid = grid.map(row => [...row]);
  const { size } = ship;
  
  for (let i = 0; i < size; i++) {
    const placeRow = orientation === 'horizontal' ? row : row + i;
    const placeCol = orientation === 'horizontal' ? col + i : col;
    newGrid[placeRow][placeCol] = CELL_STATES.SHIP;
  }
  
  return newGrid;
};

export const placeShipWithTracking = (grid, ship, row, col, orientation, shipPositions) => {
  const newGrid = grid.map(row => [...row]);
  const { size, name } = ship;
  const positions = [];
  
  for (let i = 0; i < size; i++) {
    const placeRow = orientation === 'horizontal' ? row : row + i;
    const placeCol = orientation === 'horizontal' ? col + i : col;
    newGrid[placeRow][placeCol] = CELL_STATES.SHIP;
    positions.push({ row: placeRow, col: placeCol });
  }
  
  return { 
    grid: newGrid, 
    shipPositions: [...shipPositions, { name, positions }] 
  };
};

export const processAttack = (grid, row, col) => {
  const newGrid = grid.map(row => [...row]);
  const cellState = newGrid[row][col];
  
  if (cellState === CELL_STATES.SHIP) {
    newGrid[row][col] = CELL_STATES.HIT;
    return { grid: newGrid, hit: true };
  } else if (cellState === CELL_STATES.EMPTY) {
    newGrid[row][col] = CELL_STATES.MISS;
    return { grid: newGrid, hit: false };
  }
  
  // Already attacked this cell
  return { grid: newGrid, hit: null };
};

export const checkWinCondition = (grid) => {
  return !grid.some(row => row.includes(CELL_STATES.SHIP));
};

export const getRandomPosition = () => {
  return {
    row: Math.floor(Math.random() * GRID_SIZE),
    col: Math.floor(Math.random() * GRID_SIZE),
  };
};

export const getRandomOrientation = () => {
  return Math.random() > 0.5 ? 'horizontal' : 'vertical';
};

export const placeShipsRandomly = (grid) => {
  let newGrid = grid.map(row => [...row]);
  
  for (const ship of SHIPS) {
    let placed = false;
    let attempts = 0;
    const maxAttempts = 100;
    
    while (!placed && attempts < maxAttempts) {
      const { row, col } = getRandomPosition();
      const orientation = getRandomOrientation();
      
      if (isValidPlacement(newGrid, ship, row, col, orientation)) {
        newGrid = placeShip(newGrid, ship, row, col, orientation);
        placed = true;
      }
      
      attempts++;
    }
    
    if (!placed) {
      console.error(`Could not place ${ship.name} after ${maxAttempts} attempts`);
    }
  }
  
  return newGrid;
};

export const placeShipsRandomlyWithTracking = (grid) => {
  let newGrid = grid.map(row => [...row]);
  let shipPositions = [];
  
  for (const ship of SHIPS) {
    let placed = false;
    let attempts = 0;
    const maxAttempts = 100;
    
    while (!placed && attempts < maxAttempts) {
      const { row, col } = getRandomPosition();
      const orientation = getRandomOrientation();
      
      if (isValidPlacement(newGrid, ship, row, col, orientation)) {
        const result = placeShipWithTracking(newGrid, ship, row, col, orientation, shipPositions);
        newGrid = result.grid;
        shipPositions = result.shipPositions;
        placed = true;
      }
      
      attempts++;
    }
    
    if (!placed) {
      console.error(`Could not place ${ship.name} after ${maxAttempts} attempts`);
    }
  }
  
  return { grid: newGrid, shipPositions };
};

export const placeRemainingShipsRandomly = (grid, shipPositions, startIndex) => {
  let newGrid = grid.map(row => [...row]);
  let newShipPositions = [...shipPositions];
  const placedShipNames = [];
  const placedSet = new Set(newShipPositions.map(s => s.name));
  
  for (let i = startIndex; i < SHIPS.length; i++) {
    const ship = SHIPS[i];
    if (placedSet.has(ship.name)) continue;
    
    let placed = false;
    let attempts = 0;
    const maxAttempts = 100;
    
    while (!placed && attempts < maxAttempts) {
      const { row, col } = getRandomPosition();
      const orientation = getRandomOrientation();
      
      if (isValidPlacement(newGrid, ship, row, col, orientation)) {
        const result = placeShipWithTracking(newGrid, ship, row, col, orientation, newShipPositions);
        newGrid = result.grid;
        newShipPositions = result.shipPositions;
        placed = true;
        placedSet.add(ship.name);
        placedShipNames.push(ship.name);
      }
      
      attempts++;
    }
    
    if (!placed) {
      console.error(`Could not place ${ship.name} after ${maxAttempts} attempts`);
    }
  }
  
  const nextIndex = SHIPS.findIndex(s => !placedSet.has(s.name));
  return { grid: newGrid, shipPositions: newShipPositions, placedShipNames, nextIndex: nextIndex === -1 ? SHIPS.length : nextIndex };
};

export const checkSunkShips = (shipPositions, hits) => {
  const sunkShips = [];
  
  for (const ship of shipPositions) {
    const allPositionsHit = ship.positions.every(pos => 
      hits.some(hit => hit.row === pos.row && hit.col === pos.col)
    );
    
    if (allPositionsHit) {
      sunkShips.push(ship.name);
    }
  }
  
  return sunkShips;
};


// ----------------------------- AI POLICY HELPERS ----------------------------- #

/**
 * Build the 100-character board-state key that matches ai_policy.json.
 * Mapping matches the Python trainer:
 *   0 = unknown (not attacked)
 *   1 = miss
 *   2 = hit (unsunk)
 *   3 = sunk
 */
export const getBoardKey = (computerMoves, playerShipPositions, playerSunkShips) => {
  const grid = Array(GRID_SIZE).fill(null).map(() => Array(GRID_SIZE).fill(0));

  for (const move of computerMoves) {
    const { row, col } = move;
    if (!move.hit) {
      grid[row][col] = 1; // miss
    } else {
      const isSunk = playerSunkShips.some(name => {
        const ship = playerShipPositions.find(s => s.name === name);
        return ship && ship.positions.some(pos => pos.row === row && pos.col === col);
      });
      grid[row][col] = isSunk ? 3 : 2; // sunk : hit
    }
  }

  return grid.flat().join('');
};

/**
 * Find the closest known board key to a query by Hamming distance.
 * This lets the AI generalise from similar (but not identical) states.
 */
function getClosestBoardKey(query, aiPolicy, maxDistance = 6) {
  const keys = Object.keys(aiPolicy).filter(k => k !== 'empty_board');
  let best = null;
  let bestDistance = Infinity;
  for (const key of keys) {
    if (key.length !== query.length) continue;
    let distance = 0;
    for (let i = 0; i < key.length; i++) {
      if (key[i] !== query[i]) distance++;
      if (distance >= bestDistance) break; // early exit
    }
    if (distance < bestDistance) {
      bestDistance = distance;
      best = key;
    }
  }
  return bestDistance <= maxDistance ? best : null;
}

function countKnownCells(boardKey) {
  let count = 0;
  for (const char of boardKey) {
    if (char !== '0') count++;
  }
  return count;
}

const CENTER_ROW = (GRID_SIZE - 1) / 2;
const CENTER_COL = (GRID_SIZE - 1) / 2;

function manhattanDistance(row, col) {
  return Math.abs(row - CENTER_ROW) + Math.abs(col - CENTER_COL);
}

/**
 * Return the best open cell of the given parity, sorted by closeness to the centre.
 * parity = -1 means any open cell.
 */
function getOpenCellsByParity(boardKey, parity = -1) {
  const cells = [];
  for (let i = 0; i < boardKey.length; i++) {
    if (boardKey[i] !== '0') continue;
    const row = Math.floor(i / GRID_SIZE);
    const col = i % GRID_SIZE;
    if (parity !== -1 && (row + col) % 2 !== parity) continue;
    cells.push({ row, col, distance: manhattanDistance(row, col) });
  }
  cells.sort((a, b) => a.distance - b.distance || a.row - b.row || a.col - b.col);
  return cells;
}

/**
 * A hardcoded checkerboard / parity fallback for Battleship search.
 *
 * - If an unsunk hit exists, target an orthogonally adjacent unknown cell
 *   (this is the opposite colour from the hit, so it naturally follows parity).
 * - Otherwise, fire on the open cells of a single checkerboard colour,
 *   starting from the centre and spiralling outward.
 * - If the chosen colour is exhausted, fall back to any open cell.
 */
export const getCheckerboardMove = (boardKey) => {
  const adjacent = [];
  const directions = [[-1, 0], [1, 0], [0, -1], [0, 1]];

  for (let i = 0; i < boardKey.length; i++) {
    if (boardKey[i] !== '2') continue; // 2 = unsunk hit
    const row = Math.floor(i / GRID_SIZE);
    const col = i % GRID_SIZE;
    for (const [dr, dc] of directions) {
      const nr = row + dr;
      const nc = col + dc;
      if (nr >= 0 && nr < GRID_SIZE && nc >= 0 && nc < GRID_SIZE) {
        const ni = nr * GRID_SIZE + nc;
        if (boardKey[ni] === '0') {
          adjacent.push({ row: nr, col: nc, distance: manhattanDistance(nr, nc) });
        }
      }
    }
  }

  if (adjacent.length > 0) {
    adjacent.sort((a, b) => a.distance - b.distance || a.row - b.row || a.col - b.col);
    return adjacent[0];
  }

  const evenParity = getOpenCellsByParity(boardKey, 1); // (row + col) % 2 === 1
  if (evenParity.length > 0) return evenParity[0];

  const any = getOpenCellsByParity(boardKey, -1);
  return any[0] || null;
};

function hasFourConsecutiveBlanks(boardKey) {
  // Rows
  for (let r = 0; r < GRID_SIZE; r++) {
    let run = 0;
    for (let c = 0; c < GRID_SIZE; c++) {
      if (boardKey[r * GRID_SIZE + c] === '0') {
        run++;
        if (run >= 4) return true;
      } else {
        run = 0;
      }
    }
  }
  // Columns
  for (let c = 0; c < GRID_SIZE; c++) {
    let run = 0;
    for (let r = 0; r < GRID_SIZE; r++) {
      if (boardKey[r * GRID_SIZE + c] === '0') {
        run++;
        if (run >= 4) return true;
      } else {
        run = 0;
      }
    }
  }
  return false;
}

/**
 * Structured random search: pick an unknown cell in the quarter with the
 * fewest shots so far. This naturally balances five shots per quarter before
 * starting the next round. Only used when the board still has a run of four
 * consecutive blank cells (meaning ships of length four or five could still
 * hide); otherwise it returns null so the caller can fall back to the
 * checkerboard.
 */
export const getQuarteredMove = (boardKey, computerMoves) => {
  if (!hasFourConsecutiveBlanks(boardKey)) return null;

  const quarterRegions = [
    { name: 'top-left', rows: [0, 4], cols: [0, 4] },
    { name: 'top-right', rows: [0, 4], cols: [5, 9] },
    { name: 'bottom-left', rows: [5, 9], cols: [0, 4] },
    { name: 'bottom-right', rows: [5, 9], cols: [5, 9] }
  ];

  const shotCounts = quarterRegions.map(region => ({
    ...region,
    shots: 0,
    unknowns: []
  }));

  for (const move of computerMoves) {
    const q = quarterRegions.findIndex(region =>
      move.row >= region.rows[0] && move.row <= region.rows[1] &&
      move.col >= region.cols[0] && move.col <= region.cols[1]
    );
    if (q >= 0) shotCounts[q].shots++;
  }

  for (let r = 0; r < GRID_SIZE; r++) {
    for (let c = 0; c < GRID_SIZE; c++) {
      const i = r * GRID_SIZE + c;
      if (boardKey[i] !== '0') continue;
      const q = quarterRegions.findIndex(region =>
        r >= region.rows[0] && r <= region.rows[1] &&
        c >= region.cols[0] && c <= region.cols[1]
      );
      if (q >= 0) shotCounts[q].unknowns.push({ row: r, col: c });
    }
  }

  // Prefer the quarter with the fewest shots; if tied, prefer one with more unknowns.
  shotCounts.sort((a, b) => a.shots - b.shots || b.unknowns.length - a.unknowns.length);

  for (const q of shotCounts) {
    if (q.unknowns.length > 0) {
      return q.unknowns[Math.floor(Math.random() * q.unknowns.length)];
    }
  }

  return null;
};

/**
 * Look up the Teacher's recommended move for the current board state.
 * Returns null if the model has no usable recommendation so the caller
 * can choose its own fallback (e.g. quartered random / checkerboard).
 *
 * Improvements:
 * 1. Exact match.
 * 2. empty_board for mostly-unknown states.
 * 3. Closest known state within a small Hamming distance.
 */
export const getAiMove = (boardKey, aiPolicy, computerMoves) => {
  if (!aiPolicy) return null;

  let recommendations = aiPolicy[boardKey];
  let source = 'exact';
  let matchedKey = boardKey;

  // If the board is almost empty and no exact match, use the empty-board policy
  if (!recommendations && countKnownCells(boardKey) <= 4 && aiPolicy['empty_board']) {
    recommendations = aiPolicy['empty_board'];
    source = 'empty_board';
    matchedKey = 'empty_board';
  }

  // Generalise from the closest known state (if within a small Hamming radius)
  if (!recommendations || recommendations.length === 0) {
    const closest = getClosestBoardKey(boardKey, aiPolicy, 6);
    if (closest) {
      recommendations = aiPolicy[closest];
      source = 'closest';
      matchedKey = closest;
    }
  }

  if (!recommendations || recommendations.length === 0) {
    return null;
  }

  for (const [row, col] of recommendations) {
    if (!computerMoves.some(move => move.row === row && move.col === col)) {
      return { row, col, source, key: matchedKey };
    }
  }

  // All known recommendations are already attacked; no usable model move.
  return null;
};


// ----------------------------- PLACEMENT MEMORY HELPERS ----------------------------- #

const patternKey = (pattern) => JSON.stringify(pattern);

export const generateRandomPlacementPattern = (maxAttempts = 1000) => {
  for (let i = 0; i < maxAttempts; i++) {
    const result = placeShipsRandomlyWithTracking(createEmptyGrid());
    if (result.shipPositions.length === SHIPS.length) {
      return result.shipPositions;
    }
  }
  return null;
};

export const seedPlacementMemory = (count = 100) => {
  const memory = [];
  for (let i = 0; i < count; i++) {
    const pattern = generateRandomPlacementPattern();
    if (pattern) {
      memory.push({ pattern, wins: 0, games: 0, score: 0 });
    }
  }
  return memory;
};

export const getTopPlacementPatterns = (memory, n = 3) => {
  if (!memory || memory.length === 0) return [];
  return [...memory].sort((a, b) => b.score - a.score).slice(0, n);
};

export const selectPlacementPattern = (memory) => {
  const top = getTopPlacementPatterns(memory, 3);
  if (top.length === 0) return null;
  const entry = top[Math.floor(Math.random() * top.length)];
  return entry.pattern;
};

export const applyPlacementPattern = (pattern) => {
  const grid = createEmptyGrid();
  for (const ship of pattern) {
    for (const pos of ship.positions) {
      grid[pos.row][pos.col] = CELL_STATES.SHIP;
    }
  }
  return { grid, shipPositions: pattern };
};

export const updatePlacementMemory = (memory, humanPlacement, humanWon, maxSize = 100) => {
  const key = patternKey(humanPlacement);
  let next = memory ? [...memory] : [];
  const index = next.findIndex(entry => patternKey(entry.pattern) === key);

  // Base score 1 for any human placement; +1 extra for each win
  if (index >= 0) {
    const entry = next[index];
    next[index] = {
      ...entry,
      games: entry.games + 1,
      wins: entry.wins + (humanWon ? 1 : 0),
      score: entry.score + (humanWon ? 1 : 0)
    };
  } else {
    next.unshift({
      pattern: humanPlacement,
      games: 1,
      wins: humanWon ? 1 : 0,
      score: humanWon ? 2 : 1
    });
  }

  if (next.length > maxSize) {
    next = next.slice(0, maxSize);
  }

  return next;
};


// ----------------------------- WEIGHT MAP HELPERS ----------------------------- #

/**
 * Merge a training delta into the local weight map.
 * existing and delta: { stateKey: [[row, col, win_rate, wins, samples], ...] }
 */
export const mergeWeightDelta = (existing, delta, maxActions = 8) => {
  const merged = { ...existing };

  for (const [stateKey, actions] of Object.entries(delta)) {
    let list = merged[stateKey] ? merged[stateKey].map(a => [...a]) : [];

    for (const [row, col, dWins, dSamples] of actions) {
      const idx = list.findIndex(a => a[0] === row && a[1] === col);
      if (idx >= 0) {
        list[idx][3] += dWins;
        list[idx][4] += dSamples;
      } else {
        list.push([row, col, 0, dWins, dSamples]);
      }
    }

    for (const action of list) {
      action[2] = action[4] > 0 ? action[3] / action[4] : 0.0;
    }

    list.sort((a, b) => b[2] - a[2]);
    merged[stateKey] = list.slice(0, maxActions);
  }

  return merged;
};

// ----------------------------- ARTISTIC PLACEMENT SHAPES ----------------------------- #

const ARTISTIC_SHAPES = [
  {
    name: 'U',
    segments: [
      [{ row: 0, col: 0 }, { row: 1, col: 0 }, { row: 2, col: 0 }, { row: 3, col: 0 }, { row: 4, col: 0 }],
      [{ row: 0, col: 4 }, { row: 1, col: 4 }, { row: 2, col: 4 }, { row: 3, col: 4 }],
      [{ row: 4, col: 1 }, { row: 4, col: 2 }, { row: 4, col: 3 }],
      [{ row: 0, col: 5 }, { row: 0, col: 6 }, { row: 0, col: 7 }],
      [{ row: 4, col: 4 }, { row: 4, col: 5 }]
    ]
  },
  {
    name: 'C',
    segments: [
      [{ row: 0, col: 0 }, { row: 0, col: 1 }, { row: 0, col: 2 }, { row: 0, col: 3 }, { row: 0, col: 4 }],
      [{ row: 1, col: 0 }, { row: 2, col: 0 }, { row: 3, col: 0 }],
      [{ row: 4, col: 1 }, { row: 4, col: 2 }, { row: 4, col: 3 }, { row: 4, col: 4 }],
      [{ row: 1, col: 6 }, { row: 2, col: 6 }, { row: 3, col: 6 }],
      [{ row: 4, col: 7 }, { row: 4, col: 8 }]
    ]
  },
  {
    name: 'T',
    segments: [
      [{ row: 0, col: 3 }, { row: 0, col: 4 }, { row: 0, col: 5 }, { row: 0, col: 6 }, { row: 0, col: 7 }],
      [{ row: 1, col: 5 }, { row: 2, col: 5 }, { row: 3, col: 5 }, { row: 4, col: 5 }],
      [{ row: 5, col: 5 }, { row: 5, col: 6 }, { row: 5, col: 7 }],
      [{ row: 1, col: 2 }, { row: 2, col: 2 }, { row: 3, col: 2 }],
      [{ row: 4, col: 8 }, { row: 4, col: 9 }]
    ]
  },
  {
    name: 'Zigzag',
    segments: [
      [{ row: 0, col: 0 }, { row: 0, col: 1 }, { row: 0, col: 2 }, { row: 0, col: 3 }, { row: 0, col: 4 }],
      [{ row: 1, col: 4 }, { row: 2, col: 4 }, { row: 3, col: 4 }, { row: 4, col: 4 }],
      [{ row: 4, col: 5 }, { row: 4, col: 6 }, { row: 4, col: 7 }],
      [{ row: 5, col: 7 }, { row: 6, col: 7 }, { row: 7, col: 7 }],
      [{ row: 7, col: 5 }, { row: 7, col: 6 }]
    ]
  },
  {
    name: 'Cross',
    segments: [
      [{ row: 2, col: 0 }, { row: 2, col: 1 }, { row: 2, col: 2 }, { row: 2, col: 3 }, { row: 2, col: 4 }],
      [{ row: 2, col: 6 }, { row: 2, col: 7 }, { row: 2, col: 8 }, { row: 2, col: 9 }],
      [{ row: 0, col: 5 }, { row: 1, col: 5 }, { row: 2, col: 5 }],
      [{ row: 3, col: 5 }, { row: 4, col: 5 }, { row: 5, col: 5 }],
      [{ row: 7, col: 4 }, { row: 7, col: 5 }]
    ]
  }
];

export const generateArtisticPlacementPattern = () => {
  const shape = ARTISTIC_SHAPES[Math.floor(Math.random() * ARTISTIC_SHAPES.length)];
  const segments = [...shape.segments].sort((a, b) => b.length - a.length);
  const pattern = segments.map((segment, i) => ({
    name: SHIPS[i].name,
    positions: segment
  }));
  return { pattern, shapeName: shape.name };
};