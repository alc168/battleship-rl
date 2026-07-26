import { useState, useEffect, useCallback, useRef } from 'react';
import { GAME_PHASES, ORIENTATIONS, SHIPS, CELL_STATES, GRID_SIZE, APP_VERSION } from './constants.js';
import { 
  createEmptyGrid, 
  isValidPlacement, 
  placeShipWithTracking,
  processAttack, 
  checkWinCondition,
  placeRemainingShipsRandomly,
  getRandomPosition,
  checkSunkShips,
  getBoardKey,
  getAiMove,
  seedPlacementMemory,
  selectPlacementPattern,
  applyPlacementPattern,
  updatePlacementMemory,
  mergeWeightDelta
} from './utils.js';
import { API_BASE_URL, API_KEY, TRAINING_MODE } from './config.js';
import { CONFIG } from './training.config.js';
import './index.css';

function App() {
  // Core game state: placement grid, enemy grid, and turn management
  const [gamePhase, setGamePhase] = useState(GAME_PHASES.PLACEMENT);
  const [playerGrid, setPlayerGrid] = useState(createEmptyGrid());
  const [computerGrid, setComputerGrid] = useState(createEmptyGrid());
  const [currentShipIndex, setCurrentShipIndex] = useState(0);
  const [orientation, setOrientation] = useState(ORIENTATIONS.HORIZONTAL);
  const [isPlayerTurn, setIsPlayerTurn] = useState(true);
  const [winner, setWinner] = useState(null);

  // Move tracking and ship status for both sides
  const [playerMoves, setPlayerMoves] = useState([]);
  const [computerMoves, setComputerMoves] = useState([]);
  const [playerSunkShips, setPlayerSunkShips] = useState([]);
  const [computerSunkShips, setComputerSunkShips] = useState([]);

  // Ship placement tracking and positions
  const [playerPlacedShips, setPlayerPlacedShips] = useState([]);
  const [playerShipPositions, setPlayerShipPositions] = useState([]);
  const [computerShipPositions, setComputerShipPositions] = useState([]);

  // Smart AI state: stores adjacent cells to try after a hit
  const [computerHuntTargets, setComputerHuntTargets] = useState([]);

  // Shared weight map loaded from Cloudflare KV
  const [weightMap, setWeightMap] = useState(null);

  // Memory of human ship placements; used to choose computer placements
  const [placementMemory, setPlacementMemory] = useState([]);

  // Web Worker reference for background training
  const workerRef = useRef(null);
  const isTraining = useRef(false);
  const weightMapRef = useRef(weightMap);
  const placementMemoryRef = useRef(placementMemory);
  const gamePhaseRef = useRef(gamePhase);

  useEffect(() => {
    weightMapRef.current = weightMap;
    // If the game is already active when the weight map arrives, start training
    if (weightMap && (gamePhaseRef.current === GAME_PHASES.PLAYING || gamePhaseRef.current === GAME_PHASES.GAME_OVER) && !isTraining.current) {
      scheduleNextTraining();
    }
  }, [weightMap]);

  useEffect(() => { placementMemoryRef.current = placementMemory; }, [placementMemory]);
  useEffect(() => { gamePhaseRef.current = gamePhase; }, [gamePhase]);

  // Start continuous background training whenever a game is active or has just ended
  useEffect(() => {
    if (gamePhase !== GAME_PHASES.PLAYING && gamePhase !== GAME_PHASES.GAME_OVER) return;
    if (!weightMapRef.current || isTraining.current) return;
    scheduleNextTraining();
  }, [gamePhase]);

  // Randomly place enemy ships and start the playing phase
  const startGame = useCallback(() => {
    let pattern = selectPlacementPattern(placementMemory);
    if (!pattern) {
      // Should only happen before memory is seeded; generate a fresh random fallback
      const fallback = seedPlacementMemory(1);
      pattern = fallback[0]?.pattern || [];
    }
    const result = applyPlacementPattern(pattern);
    setComputerGrid(result.grid);
    setComputerShipPositions(result.shipPositions);
    setGamePhase(GAME_PHASES.PLAYING);
  }, [placementMemory]);

  // Randomly place any ships not yet deployed, then start the game
  const handleRandomPlacement = useCallback(() => {
    const result = placeRemainingShipsRandomly(playerGrid, playerShipPositions, currentShipIndex);
    setPlayerGrid(result.grid);
    setPlayerShipPositions(result.shipPositions);
    setPlayerPlacedShips(prev => [...prev, ...result.placedShipNames]);
    startGame();
  }, [playerGrid, playerShipPositions, currentShipIndex, startGame]);

  // Keyboard shortcuts: R rotates orientation, Enter randomly places remaining ships
  useEffect(() => {
    const handleKeyDown = (event) => {
      if (gamePhase !== GAME_PHASES.PLACEMENT) return;
      
      if (event.key === 'r' || event.key === 'R') {
        setOrientation(prev => 
          prev === ORIENTATIONS.HORIZONTAL ? ORIENTATIONS.VERTICAL : ORIENTATIONS.HORIZONTAL
        );
      }
      
      if (event.key === 'Enter') {
        handleRandomPlacement();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [gamePhase, handleRandomPlacement]);

  // Load the shared weight map and placement memory from the Cloudflare Worker
  useEffect(() => {
    fetch(`${API_BASE_URL}/api/weight-map`)
      .then(response => {
        if (!response.ok) throw new Error(`Failed to load weight-map: ${response.status}`);
        return response.json();
      })
      .then(data => {
        setWeightMap(data);
        console.log('Loaded weight_map', Object.keys(data).length, 'states');
      })
      .catch(error => {
        console.error('Could not load weight_map, using fallback AI:', error);
      });

    fetch(`${API_BASE_URL}/api/top-layouts?n=100`)
      .then(response => {
        if (!response.ok) throw new Error(`Failed to load top-layouts: ${response.status}`);
        return response.json();
      })
      .then(data => {
        const formatted = data.map(r => ({
          pattern: JSON.parse(r.layout_json),
          wins: r.wins,
          games: r.games,
          score: 1 + r.wins
        }));
        setPlacementMemory(formatted);
        console.log('Loaded placement memory:', formatted.length, 'patterns');
      })
      .catch(error => {
        console.error('Failed to load placement memory, seeding locally:', error);
        const seeded = seedPlacementMemory(100);
        setPlacementMemory(seeded);
      });
  }, []);

  // After each finished game, record the human layout to D1 and update local memory
  useEffect(() => {
    if (!winner || !playerShipPositions || playerShipPositions.length === 0) return;

    const humanWon = winner === 'player';
    const layoutJson = JSON.stringify(playerShipPositions);

    // Record result asynchronously; do not block UI
    fetch(`${API_BASE_URL}/api/record`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(API_KEY && { 'X-API-Key': API_KEY }) },
      body: JSON.stringify({ layout_json: layoutJson, win: humanWon })
    }).catch(err => console.error('Failed to record layout:', err));

    // Update local placement memory immediately for the next game
    setPlacementMemory(prev => updatePlacementMemory(prev, playerShipPositions, humanWon, 100));
  }, [winner, playerShipPositions]);

  // Initialize the training Web Worker once on mount
  useEffect(() => {
    const worker = new Worker(new URL('./training.worker.js', import.meta.url), { type: 'module' });

    worker.onmessage = (event) => {
      const { type, delta, completed, elapsed, total, error } = event.data;

      if (type === 'progress') {
        console.log(`Training progress: ${completed}/${total} games`);
        return;
      }

      if (type === 'complete') {
        console.log(`Training complete: ${completed} games in ${elapsed?.toFixed?.(0)}ms`);
        if (delta && Object.keys(delta).length > 0) {
          const merged = mergeWeightDelta(weightMapRef.current || {}, delta, 8);
          weightMapRef.current = merged;
          setWeightMap(merged);
          fetch(`${API_BASE_URL}/api/merge-weights`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...(API_KEY && { 'X-API-Key': API_KEY }) },
            body: JSON.stringify({ delta })
          })
            .then(response => response.json())
            .then(data => console.log('Merged weights on server:', data))
            .catch(err => console.error('Failed to merge weights:', err));
        }
        isTraining.current = false;
        // Keep training continuously while the game is active
        scheduleNextTraining(CONFIG.CONTINUOUS_INTERVAL_MS);
        return;
      }

      if (type === 'error') {
        console.error('Training worker reported an error:', error);
        isTraining.current = false;
      }
    };

    worker.onerror = (err) => {
      console.error('Training worker error:', err);
      isTraining.current = false;
    };

    workerRef.current = worker;
    return () => worker.terminate();
  }, []);

  // Route grid clicks to placement or attack handlers based on game phase
  const handleCellClick = (row, col) => {
    if (gamePhase === GAME_PHASES.PLACEMENT) {
      handlePlacement(row, col);
    } else if (gamePhase === GAME_PHASES.PLAYING && isPlayerTurn) {
      handlePlayerAttack(row, col);
    }
  };

  // Place the current ship on the player grid and advance to the next one
  const handlePlacement = (row, col) => {
    const ship = SHIPS[currentShipIndex];
    
    if (isValidPlacement(playerGrid, ship, row, col, orientation)) {
      const result = placeShipWithTracking(playerGrid, ship, row, col, orientation, playerShipPositions);
      
      setPlayerGrid(result.grid);
      setPlayerShipPositions(result.shipPositions);
      setPlayerPlacedShips(prev => [...prev, ship.name]);
      
      if (currentShipIndex < SHIPS.length - 1) {
        setCurrentShipIndex(prev => prev + 1);
      } else {
        startGame();
      }
    }
  };

  // Process a player missile strike, update enemy grid, then hand over to the AI
  const handlePlayerAttack = (row, col) => {
    // Ignore repeated clicks on the same cell
    if (playerMoves.some(move => move.row === row && move.col === col)) {
      return;
    }

    const { grid: newComputerGrid, hit } = processAttack(computerGrid, row, col);
    const updatedMoves = [...playerMoves, { row, col, hit }];
    
    setComputerGrid(newComputerGrid);
    setPlayerMoves(updatedMoves);

    // Check for newly sunk ships using updated moves (including this hit)
    const newSunkShips = checkSunkShips(computerShipPositions, updatedMoves);
    setComputerSunkShips(newSunkShips);

    if (checkWinCondition(newComputerGrid)) {
      setWinner('player');
      setGamePhase(GAME_PHASES.GAME_OVER);
      return;
    }

    setIsPlayerTurn(false);
    
    // Computer's turn after a short delay
    setTimeout(() => {
      handleComputerAttack();
    }, 500);
  };

  // Determine whether a given grid cell belongs to a fully sunk ship
  const isCellOfSunkShip = (isComputerGrid, row, col) => {
    if (isComputerGrid) {
      return computerShipPositions.some(ship => 
        computerSunkShips.includes(ship.name) &&
        ship.positions.some(pos => pos.row === row && pos.col === col)
      );
    } else {
      return playerShipPositions.some(ship => 
        playerSunkShips.includes(ship.name) &&
        ship.positions.some(pos => pos.row === row && pos.col === col)
      );
    }
  };

  // Return the four orthogonal neighbours of a cell, filtering out invalid bounds
  const getAdjacentCells = (row, col) => {
    const adjacent = [];
    if (row > 0) adjacent.push({ row: row - 1, col });
    if (row < GRID_SIZE - 1) adjacent.push({ row: row + 1, col });
    if (col > 0) adjacent.push({ row, col: col - 1 });
    if (col < GRID_SIZE - 1) adjacent.push({ row, col: col + 1 });
    return adjacent;
  };

  // Pick the next cells to target based on the direction of recent unsunk hits
  const getHuntDirectionTargets = (row, col) => {
    // Look at recent hits to determine ship direction
    const recentHits = computerMoves.filter(move => move.hit && !isCellOfSunkShip(false, move.row, move.col));
    if (recentHits.length < 2) return getAdjacentCells(row, col);
    
    const lastHit = recentHits[recentHits.length - 1];
    const previousHit = recentHits[recentHits.length - 2];
    
    // If the last two hits are aligned, continue in that direction
    if (lastHit.row === previousHit.row) {
      // Horizontal ship
      const leftCol = Math.min(lastHit.col, previousHit.col) - 1;
      const rightCol = Math.max(lastHit.col, previousHit.col) + 1;
      const targets = [];
      if (leftCol >= 0) targets.push({ row: lastHit.row, col: leftCol });
      if (rightCol < GRID_SIZE) targets.push({ row: lastHit.row, col: rightCol });
      return targets.length > 0 ? targets : getAdjacentCells(row, col);
    } else if (lastHit.col === previousHit.col) {
      // Vertical ship
      const topRow = Math.min(lastHit.row, previousHit.row) - 1;
      const bottomRow = Math.max(lastHit.row, previousHit.row) + 1;
      const targets = [];
      if (topRow >= 0) targets.push({ row: topRow, col: lastHit.col });
      if (bottomRow < GRID_SIZE) targets.push({ row: bottomRow, col: lastHit.col });
      return targets.length > 0 ? targets : getAdjacentCells(row, col);
    }
    
    return getAdjacentCells(row, col);
  };

  // Computer turn: hunt a known hit, otherwise fire randomly
  const handleComputerAttack = () => {
    let row, col;
    
    // Filter out invalid hunt targets (already attacked or out of bounds)
    const validTargets = computerHuntTargets.filter(target => 
      target.row >= 0 && target.row < GRID_SIZE &&
      target.col >= 0 && target.col < GRID_SIZE &&
      !computerMoves.some(move => move.row === target.row && move.col === target.col)
    );
    
    if (validTargets.length > 0) {
      // Use the first valid hunt target
      const target = validTargets[0];
      row = target.row;
      col = target.col;
      setComputerHuntTargets(validTargets.slice(1));
    } else {
      // No queued hunt targets. If there are unsunk hits, prioritise sinking that ship over the weight map.
      const recentHits = computerMoves.filter(move => move.hit && !isCellOfSunkShip(false, move.row, move.col));
      let fallbackTarget = null;

      if (recentHits.length > 0) {
        const lastHit = recentHits[recentHits.length - 1];
        const fallbackTargets = getHuntDirectionTargets(lastHit.row, lastHit.col)
          .filter(t => !computerMoves.some(move => move.row === t.row && move.col === t.col));
        fallbackTarget = fallbackTargets[0] || null;
        if (fallbackTarget) {
          row = fallbackTarget.row;
          col = fallbackTarget.col;
          setComputerHuntTargets(fallbackTargets.slice(1));
        }
      }

      if (!fallbackTarget) {
        // No unsunk ship to hunt: ask the trained weight map for a move
        const boardKey = getBoardKey(computerMoves, playerShipPositions, playerSunkShips);
        const aiMove = getAiMove(boardKey, weightMap, computerMoves);

        if (aiMove) {
          row = aiMove.row;
          col = aiMove.col;
        } else {
          // Weight map has no recommendation for this state; fall back to random
          let validMove = false;
          while (!validMove) {
            const position = getRandomPosition();
            row = position.row;
            col = position.col;

            if (!computerMoves.some(move => move.row === row && move.col === col)) {
              validMove = true;
            }
          }
        }
        setComputerHuntTargets([]);
      }
    }

    const { grid: newPlayerGrid, hit } = processAttack(playerGrid, row, col);
    const updatedMoves = [...computerMoves, { row, col, hit }];
    
    setPlayerGrid(newPlayerGrid);
    setComputerMoves(updatedMoves);

    // If hit, add adjacent cells to hunt targets
    if (hit) {
      const newTargets = getHuntDirectionTargets(row, col);
      setComputerHuntTargets(prev => {
        // Add new targets to the front of the queue, but filter out duplicates and already-attacked cells
        const combined = [...newTargets, ...prev];
        const filtered = combined.filter((target, index, self) => 
          index === self.findIndex(t => t.row === target.row && t.col === target.col) &&
          !updatedMoves.some(move => move.row === target.row && move.col === target.col)
        );
        return filtered;
      });
    }

    // Check for newly sunk ships using updated moves (including this hit)
    const newSunkShips = checkSunkShips(playerShipPositions, updatedMoves);
    setPlayerSunkShips(newSunkShips);
    
    // Clear hunt targets for sunk ships
    setComputerHuntTargets(prev => prev.filter(target => !newSunkShips.some(name => {
      const sunkShip = playerShipPositions.find(ship => ship.name === name);
      return sunkShip && sunkShip.positions.some(pos => pos.row === target.row && pos.col === target.col);
    })));

    if (checkWinCondition(newPlayerGrid)) {
      setWinner('computer');
      setGamePhase(GAME_PHASES.GAME_OVER);
      return;
    }

    setIsPlayerTurn(true);
  };

  // Queue the next training batch if the game is still active
  function scheduleNextTraining(delay = CONFIG.TRAINING_DELAY_MS) {
    if (isTraining.current) return;
    if (!weightMapRef.current) return;
    if (document.hidden) return;
    if (gamePhaseRef.current !== GAME_PHASES.PLAYING && gamePhaseRef.current !== GAME_PHASES.GAME_OVER) return;

    isTraining.current = true;
    console.log('Scheduling background training in', delay, 'ms');
    setTimeout(() => {
      if (document.hidden || !workerRef.current) {
        isTraining.current = false;
        return;
      }
      console.log('Starting background training with', placementMemoryRef.current?.length || 0, 'placement patterns');
      workerRef.current.postMessage({
        weightMap: weightMapRef.current,
        placementMemory: placementMemoryRef.current
      });
    }, delay);
  }

  const resetGame = () => {
    setGamePhase(GAME_PHASES.PLACEMENT);
    setPlayerGrid(createEmptyGrid());
    setComputerGrid(createEmptyGrid());
    setCurrentShipIndex(0);
    setOrientation(ORIENTATIONS.HORIZONTAL);
    setIsPlayerTurn(true);
    setWinner(null);
    setPlayerMoves([]);
    setComputerMoves([]);
    setPlayerSunkShips([]);
    setComputerSunkShips([]);
    setPlayerPlacedShips([]);
    setPlayerShipPositions([]);
    setComputerShipPositions([]);
    setComputerHuntTargets([]);
  };

  // Build the CSS classes for a grid cell based on its contents and owner
  const getCellClass = (cellState, isComputerGrid, row, col) => {
    let baseClass = 'w-6 h-6 border flex items-center justify-center cursor-pointer relative overflow-hidden';
    const isSunk = isCellOfSunkShip(isComputerGrid, row, col);
    
    const move = isComputerGrid 
      ? playerMoves.find(m => m.row === row && m.col === col)
      : computerMoves.find(m => m.row === row && m.col === col);
    
    if (isComputerGrid) {
      if (move) {
        if (isSunk) {
          baseClass += ' sunk-cell border-red-700';
        } else if (move.hit) {
          baseClass += ' hit-cell border-red-500';
        } else {
          baseClass += ' miss-cell border-yellow-400';
        }
      } else if (gamePhase === GAME_PHASES.GAME_OVER && winner === 'computer' && cellState === CELL_STATES.SHIP) {
        // Reveal any enemy ships that survived the battle after a defeat
        baseClass += ' enemy-ship-revealed border-blue-500';
      } else {
        baseClass += ' tactical-cell border-green-600/30';
      }
    } else {
      if (move) {
        if (isSunk) {
          baseClass += ' sunk-cell border-red-700';
        } else if (move.hit) {
          baseClass += ' hit-cell border-red-500';
        } else {
          baseClass += ' miss-cell border-yellow-400';
        }
      } else if (cellState === CELL_STATES.SHIP) {
        baseClass += ' ship-cell border-gray-500';
      } else {
        baseClass += ' tactical-cell border-green-600/30';
      }
    }
    
    // Radar glow only on enemy waters for hit/miss/skull cells, never on friendly grid
    const shouldGlow = isComputerGrid && move;
    if (shouldGlow) {
      baseClass += isSunk ? ' radar-glow-sunk' : ' radar-glow';
    }
    
    return baseClass;
  };

  // Return the icon content (miss marker or skull) for a grid cell
  const getCellContent = (cellState, isComputerGrid, row, col) => {
    const isSunk = isCellOfSunkShip(isComputerGrid, row, col);
    
    if (isComputerGrid) {
      const move = playerMoves.find(m => m.row === row && m.col === col);
      if (move && !move.hit) {
        return <span className="text-yellow-900 font-bold text-sm">×</span>;
      }
      if (move && move.hit && isSunk) {
        return <span className="skull-icon">☠</span>;
      }
    } else {
      const move = computerMoves.find(m => m.row === row && m.col === col);
      if (move && !move.hit) {
        return <span className="text-yellow-900 font-bold text-sm">×</span>;
      }
      if (move && move.hit && isSunk) {
        return <span className="skull-icon">☠</span>;
      }
    }
    return null;
  };

  // Render a complete 10x10 grid with coordinates and optional radar sweep
  const renderGrid = (grid, isComputerGrid) => {
    return (
      <div className="flex flex-col gap-0.5">
        {/* Column headers */}
        <div className="flex justify-center gap-0.5 mb-0.5">
          <div className="w-5"></div> {/* Corner spacer */}
          {Array.from({ length: GRID_SIZE }, (_, i) => (
            <div key={`col-${isComputerGrid ? 'enemy' : 'player'}-${i}`} className="coordinate-label text-center py-0.5 w-5">
              {String.fromCharCode(65 + i)}
            </div>
          ))}
        </div>
        
        <div className="flex gap-0.5">
          {/* Row numbers */}
          <div className="flex flex-col gap-0.5 mr-0.5">
            {Array.from({ length: GRID_SIZE }, (_, i) => (
              <div key={`row-${isComputerGrid ? 'enemy' : 'player'}-${i}`} className="coordinate-label text-center py-1.5 w-5">
                {i + 1}
              </div>
            ))}
          </div>
          
          {/* Grid */}
          <div className="relative grid grid-cols-10 gap-0 border-2 border-green-500/30 rounded-lg overflow-hidden radar-grid">
            {isComputerGrid && <div className="radar-sweep"></div>}
            {grid.map((row, rowIndex) =>
              row.map((cell, colIndex) => (
                <div
                  key={`${isComputerGrid ? 'enemy' : 'player'}-${rowIndex * GRID_SIZE + colIndex}`}
                  className={getCellClass(cell, isComputerGrid, rowIndex, colIndex)}
                  onClick={() => handleCellClick(rowIndex, colIndex)}
                >
                  {getCellContent(cell, isComputerGrid, rowIndex, colIndex)}
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    );
  };

  // Render a visual ship icon made of squares sized to the ship length
  const renderShipIcon = (size, isSunk) => {
    const squares = Array.from({ length: size }, (_, i) => (
      <div 
        key={i} 
        className={`w-1.5 h-3 rounded-sm ${isSunk ? 'bg-red-600' : 'bg-gray-500'}`}
      ></div>
    ));
    return (
      <div className="flex gap-0.5 items-center">
        {squares}
      </div>
    );
  };

  // Render the fleet status panel showing each ship's operational state
  const renderShipStatus = (ships, sunkShips, placedShips, isPlayer) => {
    return (
      <div className="operations-panel rounded-lg p-2">
        <h3 className="text-xs font-semibold text-green-400 mb-2 uppercase tracking-wider">
          {isPlayer ? 'Friendly Fleet' : 'Enemy Contacts'}
        </h3>
        <div className="grid grid-cols-2 gap-1">
          {ships.map((ship, index) => {
            const isSunk = sunkShips.includes(ship.name);
            const isPlaced = placedShips.includes(ship.name);
            
            let status = 'pending';
            if (isSunk) status = 'sunk';
            else if (isPlaced) status = 'operational';
            
            return (
              <div key={`${isPlayer ? 'player' : 'enemy'}-${index}-${ship.name}-${status}`} className={`ship-status-compact ${status}`}>
                {renderShipIcon(ship.size, isSunk)}
                <span className="flex-1 truncate text-xs">{ship.name}</span>
                <span className="text-xs">
                  {status === 'pending' ? '⏳' : status === 'operational' ? '✓' : '☠'}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div className="screen-fit operations-room">
      {/* Header */}
      <div className="header-compact relative">
        <h1 className="text-2xl font-bold text-green-400 tracking-wider">
          ⚔️ BATTLESHIPS ⚔️
        </h1>
        <div className="absolute top-0 right-4 text-xs text-green-600 font-mono">
          v{APP_VERSION}
        </div>
      </div>
      
      {/* Status Bar */}
      <div className="status-bar">
        <div className="flex items-center gap-4">
          {gamePhase === GAME_PHASES.PLACEMENT && (
            <>
              <span className="text-green-300 text-sm">
                DEPLOY: {SHIPS[currentShipIndex].name} ({SHIPS[currentShipIndex].size})
              </span>
              <button
                onClick={() => setOrientation(
                  orientation === ORIENTATIONS.HORIZONTAL 
                    ? ORIENTATIONS.VERTICAL 
                    : ORIENTATIONS.HORIZONTAL
                )}
                className="tactical-button px-3 py-1 rounded text-xs"
              >
                {orientation === 'horizontal' ? 'HORIZ' : 'VERT'}
              </button>
              <button
                onClick={handleRandomPlacement}
                className="tactical-button px-3 py-1 rounded text-xs"
              >
                🎲 RANDOM
              </button>
            </>
          )}
          {gamePhase === GAME_PHASES.PLAYING && (
            <span className="text-green-300 text-sm">
              {isPlayerTurn ? "⚔️ YOUR TURN" : "🤖 ENEMY TURN"}
            </span>
          )}
          {gamePhase === GAME_PHASES.GAME_OVER && (
            <span className={`text-sm font-bold ${winner === 'player' ? 'text-green-400' : 'text-red-400'}`}>
              {winner === 'player' ? '🎉 MISSION ACCOMPLISHED' : '💥 MISSION FAILED'}
            </span>
          )}
        </div>
        
        <div className="flex items-center gap-2">
          <button
            onClick={resetGame}
            className="tactical-button px-3 py-1 rounded text-xs"
          >
            🔄 RESET
          </button>
          {gamePhase === GAME_PHASES.GAME_OVER && (
            <button
              onClick={resetGame}
              className="tactical-button px-3 py-1 rounded text-xs"
            >
              🎯 NEW MISSION
            </button>
          )}
        </div>
      </div>
      
      {/* Placement Instructions */}
      {gamePhase === GAME_PHASES.PLACEMENT && (
        <div className="text-center py-1">
          <span className="text-xs text-green-300 bg-gray-800/80 px-3 py-1 rounded border border-green-500/30 animate-pulse">
            🎯 Place ships in Friendly Waters — R to rotate — Enter to randomize
          </span>
        </div>
      )}
      
      {/* Game Area */}
      <div className="game-area">
        {/* Player Grid */}
        <div className="flex flex-col items-center gap-2">
          <h3 className="text-sm font-semibold text-green-400 uppercase tracking-wider">
            Friendly Waters
          </h3>
          {renderGrid(playerGrid, false)}
          {renderShipStatus(SHIPS, playerSunkShips, playerPlacedShips, true)}
        </div>
        
        {/* Computer Grid */}
        {gamePhase !== GAME_PHASES.PLACEMENT && (
          <div className="flex flex-col items-center gap-2">
            <h3 className="text-sm font-semibold text-green-400 uppercase tracking-wider">
              Enemy Waters
            </h3>
            {gamePhase === GAME_PHASES.PLAYING && playerMoves.length === 0 && (
              <div className="text-xs text-green-300 bg-gray-800/80 px-3 py-1 rounded border border-green-500/30 animate-pulse">
                🎯 Click any square to fire a missile
              </div>
            )}
            {renderGrid(computerGrid, true)}
            {renderShipStatus(SHIPS, computerSunkShips, gamePhase === GAME_PHASES.PLAYING ? SHIPS.map(s => s.name) : [], false)}
          </div>
        )}
      </div>
      
      {/* Legend */}
      <div className="h-12 flex items-center justify-center gap-4 operations-panel rounded-lg px-4">
        {SHIPS.map((ship) => (
          <div key={`legend-${ship.name}`} className="flex items-center gap-1">
            {renderShipIcon(ship.size, false)}
            <span className="text-green-300 text-xs">{ship.name}</span>
          </div>
        ))}
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 tactical-cell rounded"></div>
          <span className="text-green-300 text-xs">WATER</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 hit-cell rounded"></div>
          <span className="text-green-300 text-xs">HIT</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 miss-cell rounded"></div>
          <span className="text-green-300 text-xs">MISS</span>
        </div>
      </div>

      {/* Win Screen Banner */}
      {gamePhase === GAME_PHASES.GAME_OVER && (
        <div className="fixed top-16 left-1/2 -translate-x-1/2 z-50 w-auto max-w-lg">
          <div className="operations-panel rounded-2xl p-4 text-center border-2 border-green-500/50 shadow-2xl">
            <div className="flex items-center justify-center gap-3 mb-2">
              <span className="text-3xl">{winner === 'player' ? '🎉' : '💥'}</span>
              <h2 className="text-2xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-green-400 to-cyan-400">
                {winner === 'player' ? 'VICTORY' : 'DEFEAT'}
              </h2>
            </div>
            <p className="text-green-200 text-sm mb-3">
              {winner === 'player' 
                ? 'Enemy fleet destroyed — well done, Admiral!' 
                : 'Your fleet has been destroyed...'}
            </p>
            <button
              onClick={resetGame}
              className="tactical-button px-6 py-2 rounded-lg text-sm font-bold"
            >
              🎯 NEW MISSION
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;