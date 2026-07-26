import { test, expect } from '../lib/harness.mjs';
import { CELL_STATES } from '../../web/src/constants.js';
import {
  createEmptyGrid,
  isValidPlacement,
  placeShip,
  placeShipWithTracking,
  processAttack,
  checkWinCondition,
  placeShipsRandomlyWithTracking,
  checkSunkShips,
  getBoardKey,
  getAiMove,
  getTopPlacementPatterns,
  applyPlacementPattern,
  updatePlacementMemory,
  mergeWeightDelta
} from '../../web/src/utils.js';

test('createEmptyGrid returns 10x10 grid of EMPTY cells', () => {
  const grid = createEmptyGrid();
  expect(grid.length).toBe(10);
  expect(grid.every(row => row.length === 10 && row.every(cell => cell === CELL_STATES.EMPTY))).toBe(true);
}, { component: 'Game logic', control: 'CC7.2' });

test('isValidPlacement checks boundaries and overlap', () => {
  const grid = createEmptyGrid();
  const destroyer = { name: 'Destroyer', size: 2 };
  expect(isValidPlacement(grid, destroyer, 0, 9, 'horizontal')).toBe(false); // exceeds right
  expect(isValidPlacement(grid, destroyer, 9, 0, 'vertical')).toBe(false); // exceeds bottom
  expect(isValidPlacement(grid, destroyer, 0, 0, 'horizontal')).toBe(true);
}, { component: 'Game logic', control: 'CC7.2' });

test('placeShip marks cells as SHIP', () => {
  const grid = createEmptyGrid();
  const result = placeShip(grid, { name: 'Submarine', size: 3 }, 2, 3, 'vertical');
  expect(result[2][3]).toBe(CELL_STATES.SHIP);
  expect(result[3][3]).toBe(CELL_STATES.SHIP);
  expect(result[4][3]).toBe(CELL_STATES.SHIP);
}, { component: 'Game logic', control: 'CC7.2' });

test('placeShipWithTracking returns grid and ship positions', () => {
  const grid = createEmptyGrid();
  const { grid: newGrid, shipPositions } = placeShipWithTracking(grid, { name: 'Carrier', size: 5 }, 0, 0, 'horizontal', []);
  expect(shipPositions.length).toBe(1);
  expect(shipPositions[0].positions.length).toBe(5);
  expect(newGrid[0][4]).toBe(CELL_STATES.SHIP);
}, { component: 'Game logic', control: 'CC7.2' });

test('placeShipsRandomlyWithTracking places all five ships', () => {
  const { grid, shipPositions } = placeShipsRandomlyWithTracking(createEmptyGrid());
  expect(shipPositions.length).toBe(5);
  const shipCells = grid.flat().filter(c => c === CELL_STATES.SHIP).length;
  expect(shipCells).toBe(17); // 5+4+3+3+2
}, { component: 'Game logic', control: 'CC7.2' });

test('processAttack marks HIT for SHIP and MISS for EMPTY', () => {
  const grid = createEmptyGrid();
  grid[0][0] = CELL_STATES.SHIP;
  const hit = processAttack(grid, 0, 0);
  expect(hit.hit).toBe(true);
  expect(hit.grid[0][0]).toBe(CELL_STATES.HIT);

  const miss = processAttack(hit.grid, 0, 1);
  expect(miss.hit).toBe(false);
  expect(miss.grid[0][1]).toBe(CELL_STATES.MISS);

  const again = processAttack(miss.grid, 0, 0);
  expect(again.hit).toBeNull();
}, { component: 'Game logic', control: 'CC7.2' });

test('checkWinCondition is false until all ships are hit', () => {
  const grid = createEmptyGrid();
  grid[0][0] = CELL_STATES.SHIP;
  grid[0][1] = CELL_STATES.SHIP;
  expect(checkWinCondition(grid)).toBe(false);
  const g1 = processAttack(grid, 0, 0).grid;
  const g2 = processAttack(g1, 0, 1).grid;
  expect(checkWinCondition(g2)).toBe(true);
}, { component: 'Game logic', control: 'CC7.2' });

test('checkSunkShips identifies a fully hit ship', () => {
  const shipPositions = [{ name: 'Destroyer', positions: [{ row: 0, col: 0 }, { row: 0, col: 1 }] }];
  expect(checkSunkShips(shipPositions, []).length).toBe(0);
  const hits1 = [{ row: 0, col: 1, hit: true }];
  expect(checkSunkShips(shipPositions, hits1).length).toBe(0);
  const hits2 = [{ row: 0, col: 0, hit: true }, { row: 0, col: 1, hit: true }];
  expect(checkSunkShips(shipPositions, hits2)).toEqual(['Destroyer']);
}, { component: 'Game logic', control: 'CC7.2' });

test('getBoardKey encodes board state into a 100-character string', () => {
  const moves = [{ row: 0, col: 0, hit: true }, { row: 1, col: 1, hit: false }];
  const key = getBoardKey(moves, [], []);
  expect(key.length).toBe(100);
  expect(key[0]).toBe('2'); // hit encoded as 2
  expect(key[11]).toBe('1'); // miss encoded as 1 (row 1, col 1)
}, { component: 'AI policy', control: 'CC7.2' });

test('getAiMove returns the next unshot coordinate from the ordered policy', () => {
  const boardKey = '0000000000';
  const aiPolicy = {
    [boardKey]: [
      [0, 1, 0.8, 10, 5],
      [0, 2, 0.7, 10, 4],
      [0, 0, 0.6, 10, 3]
    ]
  };
  const move = getAiMove(boardKey, aiPolicy, []);
  expect(move).toEqual({ row: 0, col: 1, source: 'exact', key: boardKey });

  const moveAfterShot = getAiMove(boardKey, aiPolicy, [{ row: 0, col: 1, hit: true }]);
  expect(moveAfterShot).toEqual({ row: 0, col: 2, source: 'exact', key: boardKey });
}, { component: 'AI policy', control: 'CC7.2' });

test('getAiMove returns null for unknown or exhausted states', () => {
  expect(getAiMove('unknown', { some: [] }, [])).toBeNull();
}, { component: 'AI policy', control: 'CC7.2' });

test('getTopPlacementPatterns sorts by win rate and respects limit', () => {
  const memory = [
    { pattern: 'A', score: 0.1 },
    { pattern: 'B', score: 0.9 },
    { pattern: 'C', score: 0.5 }
  ];
  const top = getTopPlacementPatterns(memory, 2);
  expect(top.length).toBe(2);
  expect(top[0].pattern).toBe('B');
  expect(top[1].pattern).toBe('C');
}, { component: 'Placement memory', control: 'CC7.2' });

test('applyPlacementPattern writes ships to grid', () => {
  const pattern = [
    { name: 'Carrier', positions: [
      { row: 0, col: 0 }, { row: 0, col: 1 }, { row: 0, col: 2 }, { row: 0, col: 3 }, { row: 0, col: 4 }
    ]}
  ];
  const { grid, shipPositions } = applyPlacementPattern(pattern);
  expect(shipPositions.length).toBe(1);
  expect(grid[0].filter(c => c === CELL_STATES.SHIP).length).toBe(5);
}, { component: 'Placement memory', control: 'CC7.2' });

test('updatePlacementMemory adds and ranks placements', () => {
  const memory = [];
  const placement = [{ name: 'Carrier', positions: [{ row: 0, col: 0 }] }];
  const updated = updatePlacementMemory(memory, placement, true, 100);
  expect(updated.length).toBe(1);
  expect(updated[0].wins).toBe(1);
  expect(updated[0].games).toBe(1);
  expect(updated[0].score).toBe(2); // base 1 + 1 for a win
}, { component: 'Placement memory', control: 'CC7.2' });

test('mergeWeightDelta combines and ranks actions', () => {
  const existing = {
    state: [[0, 0, 0.5, 10, 10]]
  };
  const delta = {
    state: [[0, 0, 1, 2]]
  };
  const merged = mergeWeightDelta(existing, delta, 5);
  expect(merged.state[0][3]).toBe(11); // wins
  expect(merged.state[0][4]).toBe(12); // samples
}, { component: 'AI policy', control: 'CC7.2' });
