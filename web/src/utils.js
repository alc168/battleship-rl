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

/**
 * Look up the Teacher's recommended move for the current board state.
 * Falls back to null so the caller can use random/hunt logic instead.
 *
 * Improvements:
 * 1. Exact match.
 * 2. empty_board for mostly-unknown states.
 * 3. Closest known state within a small Hamming distance.
 */
export const getAiMove = (boardKey, aiPolicy, computerMoves) => {
  if (!aiPolicy) return null;

  const emptyKey = '0'.repeat(GRID_SIZE * GRID_SIZE);
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

  if (!recommendations || recommendations.length === 0) return null;

  for (const [row, col] of recommendations) {
    if (!computerMoves.some(move => move.row === row && move.col === col)) {
      return { row, col, source, key: matchedKey };
    }
  }

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