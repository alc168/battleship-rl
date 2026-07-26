import { test, expect } from '../lib/harness.mjs';
import { CELL_STATES, SHIPS } from '../../web/src/constants.js';
import {
  createEmptyGrid,
  getRandomPosition,
  getRandomOrientation,
  placeShipWithTracking,
  placeShipsRandomly,
  placeShipsRandomlyWithTracking,
  placeRemainingShipsRandomly,
  seedPlacementMemory,
  mergeWeightDelta,
  updatePlacementMemory,
  getTopPlacementPatterns,
  selectPlacementPattern
} from '../../web/src/utils.js';

test('getRandomPosition returns in-bounds integer coordinates', () => {
  for (let i = 0; i < 100; i++) {
    const { row, col } = getRandomPosition();
    expect(Number.isInteger(row)).toBe(true);
    expect(Number.isInteger(col)).toBe(true);
    expect(row).toBeGreaterThan(-1);
    expect(row).toBeLessThan(10);
    expect(col).toBeGreaterThan(-1);
    expect(col).toBeLessThan(10);
  }
}, { component: 'Game logic', control: 'CC7.2' });

test('getRandomOrientation returns a valid orientation', () => {
  for (let i = 0; i < 100; i++) {
    const orientation = getRandomOrientation();
    expect(['horizontal', 'vertical'].includes(orientation)).toBe(true);
  }
}, { component: 'Game logic', control: 'CC7.2' });

test('placeShipsRandomly places the full fleet of 17 cells', () => {
  const grid = placeShipsRandomly(createEmptyGrid());
  const shipCells = grid.flat().filter(c => c === CELL_STATES.SHIP).length;
  expect(shipCells).toBe(17);
}, { component: 'Game logic', control: 'CC7.2' });

test('placeShipsRandomlyWithTracking returns a grid and all ship positions', () => {
  const { grid, shipPositions } = placeShipsRandomlyWithTracking(createEmptyGrid());
  expect(shipPositions.length).toBe(5);
  const shipCells = grid.flat().filter(c => c === CELL_STATES.SHIP).length;
  expect(shipCells).toBe(17);
}, { component: 'Game logic', control: 'CC7.2' });

test('placeRemainingShipsRandomly from startIndex 0 places the full fleet', () => {
  const { grid, shipPositions, placedShipNames, nextIndex } = placeRemainingShipsRandomly(
    createEmptyGrid(),
    [],
    0
  );
  const shipCells = grid.flat().filter(c => c === CELL_STATES.SHIP).length;
  expect(shipCells).toBe(17);
  expect(shipPositions.length).toBe(5);
  expect(placedShipNames.length).toBe(5);
  expect(nextIndex).toBe(SHIPS.length);
}, { component: 'Game logic', control: 'CC7.2' });

test('placeRemainingShipsRandomly respects already-placed ships and fills the rest', () => {
  const carrier = SHIPS[0];
  const { grid: partialGrid, shipPositions: [firstShip] } = placeShipWithTracking(
    createEmptyGrid(),
    carrier,
    0,
    0,
    'horizontal',
    []
  );
  const { grid, shipPositions, nextIndex } = placeRemainingShipsRandomly(
    partialGrid,
    [firstShip],
    1
  );
  const shipCells = grid.flat().filter(c => c === CELL_STATES.SHIP).length;
  expect(shipCells).toBe(17);
  expect(shipPositions.length).toBe(5);
  expect(nextIndex).toBe(SHIPS.length);
}, { component: 'Game logic', control: 'CC7.2' });

test('seedPlacementMemory produces valid placement patterns', () => {
  const memory = seedPlacementMemory(3);
  expect(memory.length).toBeGreaterThan(1);
  for (const entry of memory) {
    expect(entry).toHaveProperty('pattern');
    expect(entry).toHaveProperty('wins');
    expect(entry).toHaveProperty('games');
    expect(entry).toHaveProperty('score');
    expect(entry.pattern.length).toBe(5);
  }
}, { component: 'Placement memory', control: 'CC7.2' });

test('mergeWeightDelta prunes actions to maxActions and recalculates win rate', () => {
  const existing = {
    s: [
      [0, 0, 0.1, 1, 1],
      [0, 1, 0.2, 2, 2],
      [0, 2, 0.3, 3, 3]
    ]
  };
  const delta = {
    s: [
      [0, 0, 1, 1],
      [0, 3, 1, 1],
      [0, 4, 1, 1]
    ]
  };
  const merged = mergeWeightDelta(existing, delta, 2);
  expect(merged.s.length).toBe(2);
  for (const action of merged.s) {
    expect(action[2]).toBe(action[3] / action[4]);
  }
}, { component: 'AI policy', control: 'CC7.2' });

test('updatePlacementMemory respects maxSize and updates existing patterns', () => {
  const p1 = [{ name: 'Carrier', positions: [{ row: 0, col: 1 }] }];
  const p2 = [{ name: 'Carrier', positions: [{ row: 1, col: 0 }] }];
  const p3 = [{ name: 'Carrier', positions: [{ row: 2, col: 0 }] }];

  let memory = updatePlacementMemory([], p1, true, 2);
  expect(memory.length).toBe(1);
  expect(memory[0].wins).toBe(1);
  expect(memory[0].games).toBe(1);

  memory = updatePlacementMemory(memory, p1, false, 2);
  expect(memory.length).toBe(1);
  expect(memory[0].wins).toBe(1);
  expect(memory[0].games).toBe(2);

  memory = updatePlacementMemory(memory, p2, true, 2);
  expect(memory.length).toBe(2);

  memory = updatePlacementMemory(memory, p3, true, 2);
  expect(memory.length).toBe(2);
}, { component: 'Placement memory', control: 'CC7.2' });

test('getTopPlacementPatterns sorts by score and respects the limit', () => {
  const memory = [
    { pattern: 'A', score: 1 },
    { pattern: 'B', score: 9 },
    { pattern: 'C', score: 5 },
    { pattern: 'D', score: 3 }
  ];
  const top = getTopPlacementPatterns(memory, 2);
  expect(top.length).toBe(2);
  expect(top[0].pattern).toBe('B');
  expect(top[1].pattern).toBe('C');
}, { component: 'Placement memory', control: 'CC7.2' });

test('getTopPlacementPatterns handles an empty or small memory', () => {
  expect(getTopPlacementPatterns([], 3).length).toBe(0);
  expect(getTopPlacementPatterns([{ pattern: 'A', score: 5 }], 3).length).toBe(1);
}, { component: 'Placement memory', control: 'CC7.2' });

test('selectPlacementPattern returns a pattern from the top entries', () => {
  const pA = [{ name: 'Carrier', positions: [{ row: 0, col: 0 }] }];
  const pB = [{ name: 'Carrier', positions: [{ row: 0, col: 1 }] }];
  const pC = [{ name: 'Carrier', positions: [{ row: 0, col: 2 }] }];
  const memory = [
    { pattern: pA, wins: 1, games: 1, score: 2 },
    { pattern: pB, wins: 1, games: 1, score: 2 },
    { pattern: pC, wins: 1, games: 1, score: 2 }
  ];
  const selected = selectPlacementPattern(memory);
  expect([pA, pB, pC].some(p => JSON.stringify(p) === JSON.stringify(selected))).toBe(true);
}, { component: 'Placement memory', control: 'CC7.2' });
