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
  
  for (let i = startIndex; i < SHIPS.length; i++) {
    const ship = SHIPS[i];
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
        placedShipNames.push(ship.name);
      }
      
      attempts++;
    }
    
    if (!placed) {
      console.error(`Could not place ${ship.name} after ${maxAttempts} attempts`);
    }
  }
  
  return { grid: newGrid, shipPositions: newShipPositions, placedShipNames };
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
 * Look up the Teacher's recommended move for the current board state.
 * Falls back to null so the caller can use random/hunt logic instead.
 */
export const getAiMove = (boardKey, aiPolicy, computerMoves) => {
  if (!aiPolicy) return null;

  let recommendations = aiPolicy[boardKey];
  const emptyKey = '0'.repeat(GRID_SIZE * GRID_SIZE);
  if (!recommendations && boardKey === emptyKey && aiPolicy['empty_board']) {
    recommendations = aiPolicy['empty_board'];
  }

  if (!recommendations || recommendations.length === 0) return null;

  for (const [row, col] of recommendations) {
    if (!computerMoves.some(move => move.row === row && move.col === col)) {
      return { row, col };
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