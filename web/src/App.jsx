import { useState, useEffect, useCallback, useRef } from 'react';
import { GAME_PHASES, ORIENTATIONS, SHIPS, GRID_SIZE } from './constants.js';
import { useAudio } from './hooks/useAudio.js';
import { useVoiceovers } from './hooks/useVoiceovers.js';
import { useMobile } from './hooks/useMobile.js';
import { useTraining } from './hooks/useTraining.js';
import { Header } from './components/Header.jsx';
import { StatusBar } from './components/StatusBar.jsx';
import { InfoPanel } from './components/InfoPanel.jsx';
import { GameGrid } from './components/GameGrid.jsx';
import { 
  createEmptyGrid, 
  isValidPlacement, 
  placeShipWithTracking,
  processAttack, 
  checkWinCondition,
  placeRemainingShipsRandomly,
  checkSunkShips,
  getBoardKey,
  getHuntDirectionTargets,
  seedPlacementMemory,
  selectPlacementPattern,
  applyPlacementPattern,
  generateArtisticPlacementPattern,
  updatePlacementMemory,
  mergeWeightDelta
} from './utils.js';
import { getEnsembleMove } from './experts.js';
import { API_BASE_URL, API_KEY } from './config.js';
import { CONFIG } from './training.config.js';
import './index.css';

// A curated set of fortune-cookie-style asides for the Computer Tactical Console.
// Styled after the classic Unix `fortune` program.
const FORTUNES = [
  'A ship in harbour is safe, but that is not what ships are built for.',
  'You will soon discover that the ocean is mostly water.',
  'Patience is a virtue, unless you are being shelled.',
  'The wise admiral checks the weather before firing the first shot.',
  'To err is human; to miss entirely, also human.',
  'A destroyer in the hand is worth two on the grid.',
  'You cannot win if you do not shoot, but you can certainly lose elegantly.',
  'Fortune favours the bold, and occasionally the algorithmically fortunate.',
  'The early torpedo catches the cruiser.',
  'Do not count your carriers before they have floated.',
  'Battleship is like tea: best served with a bit of strategy and a lot of luck.',
  'If at first you do not hit, try the square next door.',
  'A calm sea never made a skilled sailor, but it does make aiming easier.',
  'You will find what you seek, provided it is a battleship and you aim correctly.',
  'The best defence is not being where the missiles land.'
];

function randomFortune() {
  return FORTUNES[Math.floor(Math.random() * FORTUNES.length)];
}

function getThinkingMessage(source, winRate, row, col, humor) {
  const p = Math.round(winRate * 100);
  const sq = `[${row},${col}]`;

  const messages = {
    hunt: [
      `Hunt mode: pursuing adjacent targets around a known hit.`,
      `One hit does not a sunk ship make, but it does rather narrow the possibilities.`,
      `I smell a ship. Or possibly a submarine. Either way, adjacent squares are now terribly unsafe.`,
      `A hit! The hunt begins. What is life but a series of adjacent squares waiting to be explored?`
    ],
    exact: [
      `I have seen this exact board before. The model recommends ${sq} with a ${p}% win probability.`,
      `Ah, an old acquaintance of a board. ${sq} has a ${p}% chance of being productive.`,
      `Déjà vu! I have been here before, and ${sq} looks promising at ${p}%.`,
      `The universe repeats itself, and this board whispers that ${sq} is our destiny — ${p}% likely.`
    ],
    empty_board: [
      `The board is mostly unknown. Using the empty-board opening policy.`,
      `So little information, so many ocean tiles. Let us start with a classic.`,
      `It is all a bit of a mystery, is it not? I shall probe ${sq} and see if anyone is home.`,
      `In the void of the unknown, I choose ${sq}. If a ship is there, is it truly found?`
    ],
    closest: [
      `No exact match, but a similar state is within reach. Using its recommendation for ${sq} (${p}% win rate).`,
      `Not this exact board, but a near neighbour. ${sq} seems the best bet at ${p}%.`,
      `I have not seen this precise mess, but I know a board that looks just like it. ${sq} at ${p}%.`,
      `All states are echoes. ${sq} is the closest echo, ${p}% loud.`
    ],
    random: [
      `No known policy for this state. Firing at random.`,
      `I have not a clue, so ${sq} it is. Could be water, could be a destroyer; life is full of surprises.`,
      `Complete guesswork. If this hits, it is definitely skill and not luck.`,
      `Chaos is the only true captain. I surrender to ${sq}.`
    ],
    quartered: [
      `The model is silent, but the admiral still has a chart. I shall explore the ${sq} sector in a balanced quarter.`,
      `No learned move, so I am dividing the ocean into quarters and firing at ${sq} in the least-searched one.`,
      `One searches a large sea in sections, like a polite queue. ${sq} is this section's candidate.`,
      `Strategy without data becomes geometry. ${sq} it is, in the name of even coverage.`
    ],
    probability: [
      `I am summing every legal placement of the remaining ships. ${sq} sits on the highest probability.`,
      `Not guessing — calculating. ${sq} is the densest point on the board.`,
      `A Bayesian battleship admiral would fire at ${sq}. I have no reason to disagree.`,
      `The remaining fleet could be in many places; ${sq} is where the most of those places overlap.`
    ],
    coverage: [
      `The numbers are thin here, so I am going where few shots have landed: ${sq}.`,
      `No strong probability, but the seas around ${sq} are comparatively unexplored.`,
      `When the map is flat, spread the search. ${sq} is in the least-shot neighbourhood.`,
      `Explore first, exploit later. ${sq} has room to hide a ship.`
    ],
    checkerboard: [
      `No learned override for this state. Falling back to the classic checkerboard pattern at ${sq}.`,
      `Parity is a powerful ally. I shall test ${sq} in the checkerboard hunt.`,
      `Every ship of length two touches both colours, so ${sq} on the opposite colour is a safe bet.`,
      `When in doubt, trust the checkerboard. ${sq} it is.`
    ]
  };

  const message = messages[source]?.[humor] ?? messages[source]?.[0] ?? 'Thinking...';

  let includeFortune = false;
  if (humor >= 3) includeFortune = true;
  else if (humor >= 2) includeFortune = Math.random() < 0.5;
  else if (humor >= 1) includeFortune = Math.random() < 0.2;

  if (includeFortune) {
    return `${message}\n\nFortune cookie: ${randomFortune()}`;
  }
  return message;
}

function renderShipIcon(size, isSunk) {
  const squares = Array.from({ length: size }, (_, i) => (
    <div
      key={i}
      className={'w-1.5 h-3 rounded-sm ' + (isSunk ? 'bg-red-600' : 'bg-gray-500')}
    ></div>
  ));
  return <div className="flex gap-0.5 items-center">{squares}</div>;
}

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

  const [soundOn, setSoundOn] = useState(true);
  const playSound = useAudio(soundOn);
  const playVoiceover = useVoiceovers(soundOn);
  const isMobile = useMobile();

  // Voiceover pacing for Cheeky and Philosophical personalities
  const computerTurnCountRef = useRef(0);
  const nextVoiceoverTurnRef = useRef(null);

  // Tactical console: info panel, logs, and last computer decision
  // Tactical console is open by default on all viewports
  const [showInfoPanel, setShowInfoPanel] = useState(true);
  const [consoleLog, setConsoleLog] = useState([]);
  const [computerDecision, setComputerDecision] = useState(null);
  const [heatMap, setHeatMap] = useState(null);
  const [firedProbabilities, setFiredProbabilities] = useState({});
  const [humorLevel, setHumorLevel] = useState(1);
  const [humanGames, setHumanGames] = useState(0);
  const [syntheticGames, setSyntheticGames] = useState(0);
  const [knownStates, setKnownStates] = useState(0);

  // Draggable game-over banner offset (mouse + touch)
  const [bannerOffset, setBannerOffset] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef({ x: 0, y: 0, offsetX: 0, offsetY: 0 });


  const consoleFeedRef = useRef(null);
  const introTriggeredForGameRef = useRef(false);
  const shouldPlayIntroRef = useRef(false);
  const pendingDeltaRef = useRef({});
  const pendingGamesRef = useRef(0);
  const batchesSinceUploadRef = useRef(0);

  const addLog = useCallback((message) => {
    const timestamp = new Date().toLocaleTimeString();
    setConsoleLog(prev => [...prev.slice(-99), `[${timestamp}] ${message}`]);
  }, []);

  // Dragging the game-over banner so the final board layout can be inspected
  const startBannerDrag = (clientX, clientY) => {
    dragStartRef.current = {
      x: clientX,
      y: clientY,
      offsetX: bannerOffset.x,
      offsetY: bannerOffset.y
    };
    setIsDragging(true);
  };

  const handleBannerMouseDown = (e) => {
    if (e.target.closest('button')) return;
    startBannerDrag(e.clientX, e.clientY);
  };

  const handleBannerTouchStart = (e) => {
    if (e.target.closest('button')) return;
    const touch = e.touches[0];
    startBannerDrag(touch.clientX, touch.clientY);
  };

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e) => {
      setBannerOffset({
        x: dragStartRef.current.offsetX + (e.clientX - dragStartRef.current.x),
        y: dragStartRef.current.offsetY + (e.clientY - dragStartRef.current.y)
      });
    };

    const handleMouseUp = () => setIsDragging(false);

    const handleTouchMove = (e) => {
      const touch = e.touches[0];
      setBannerOffset({
        x: dragStartRef.current.offsetX + (touch.clientX - dragStartRef.current.x),
        y: dragStartRef.current.offsetY + (touch.clientY - dragStartRef.current.y)
      });
    };

    const handleTouchEnd = () => setIsDragging(false);

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    window.addEventListener('touchmove', handleTouchMove, { passive: false });
    window.addEventListener('touchend', handleTouchEnd);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('touchmove', handleTouchMove);
      window.removeEventListener('touchend', handleTouchEnd);
    };
  }, [isDragging]);

  const fetchStats = useCallback(() => {
    fetch(`${API_BASE_URL}/api/stats`)
      .then(response => response.json())
      .then(data => {
        setHumanGames(data.human_games || 0);
        setSyntheticGames(data.synthetic_games || 0);
        setKnownStates(data.states || 0);
      })
      .catch(error => addLog(`Failed to load stats: ${error.message || error}`));
  }, [addLog]);

  // Merge a training delta into the local weight map and push it to the server
  // less frequently to stay inside the Cloudflare KV free tier.
  const handleTrainingDelta = useCallback((delta, completed) => {
    setSyntheticGames(prev => prev + (completed || 0));
    if (!delta || Object.keys(delta).length === 0) return;

    setWeightMap(prev => mergeWeightDelta(prev || {}, delta, 8));
    pendingDeltaRef.current = mergeWeightDelta(pendingDeltaRef.current, delta, 8);
    pendingGamesRef.current += (completed || 0);
    batchesSinceUploadRef.current += 1;

    const compactPending = (pending) => {
      const result = {};
      for (const [state, actions] of Object.entries(pending)) {
        result[state] = actions.map(a => [a[0], a[1], a[3], a[4]]);
      }
      return result;
    };

    const pendingStates = Object.keys(pendingDeltaRef.current).length;
    const uploadDelta = compactPending(pendingDeltaRef.current);
    const pendingBytes = new TextEncoder().encode(JSON.stringify(uploadDelta)).length;

    if (
      batchesSinceUploadRef.current >= CONFIG.UPLOAD_INTERVAL_BATCHES ||
      pendingStates > 8000 ||
      pendingBytes > 1_800_000
    ) {
      fetch(`${API_BASE_URL}/api/merge-weights`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(API_KEY && { 'X-API-Key': API_KEY }) },
        body: JSON.stringify({ delta: uploadDelta, games: pendingGamesRef.current })
      })
        .then(response => response.json())
        .then(data => {
          addLog(`Merged weights on server: ${data.states} states`);
        })
        .catch(err => addLog(`Failed to merge weights: ${err.message}`))
        .finally(() => {
          pendingDeltaRef.current = {};
          pendingGamesRef.current = 0;
          batchesSinceUploadRef.current = 0;
        });
    }
  }, [setSyntheticGames, setWeightMap, addLog]);

  // Initialize the background training worker
  useTraining(weightMap, placementMemory, handleTrainingDelta, addLog);

  // Keep the known-states counter in sync with the local weight map
  useEffect(() => {
    setKnownStates(weightMap ? Object.keys(weightMap).length : 0);
  }, [weightMap]);

  // Keep the console scrolled to the top (latest message visible)
  useEffect(() => {
    if (consoleFeedRef.current) {
      consoleFeedRef.current.scrollTop = 0;
    }
  }, [consoleLog]);

  // Randomly place enemy ships and start the playing phase
  const startGame = useCallback(() => {
    const memoryCount = placementMemory.length;
    addLog(`Reviewing ${memoryCount} stored human board layout${memoryCount === 1 ? '' : 's'}...`);
    setComputerDecision({ thinking: `Reviewing ${memoryCount} stored human board layout${memoryCount === 1 ? '' : 's'} and selecting a defensive deployment...`, source: 'placement' });

    let pattern;
    let shapeName = null;
    const isArtistic = humorLevel >= 2 && Math.random() < 0.2;

    if (isArtistic) {
      const artistic = generateArtisticPlacementPattern();
      pattern = artistic.pattern;
      shapeName = artistic.shapeName;
      addLog(`Defensive deployment configured in a ${shapeName} formation, just to keep things interesting.`);
    } else {
      pattern = selectPlacementPattern(placementMemory);
      if (!pattern) {
        // Should only happen before memory is seeded; generate a fresh random fallback
        const fallback = seedPlacementMemory(1);
        pattern = fallback[0]?.pattern || [];
      }
    }
    let result = applyPlacementPattern(pattern);

    // Guard against malformed or incomplete placement patterns (e.g. test data with fewer ships)
    if (result.shipPositions.length !== SHIPS.length) {
      addLog('Placement pattern was incomplete; falling back to random computer placement.');
      result = placeShipsRandomlyWithTracking(createEmptyGrid());
      shapeName = null;
    }

    if (shapeName) {
      setComputerDecision({ thinking: `Defensive deployment configured in a ${shapeName} formation. Awaiting your opening salvo.`, source: 'placement' });
    } else {
      addLog('Defensive deployment selected and concealed from the enemy.');
      setComputerDecision({ thinking: 'Defensive deployment selected and concealed. Awaiting your opening salvo.', source: 'placement' });
    }

    setComputerGrid(result.grid);
    setComputerShipPositions(result.shipPositions);
    setGamePhase(GAME_PHASES.PLAYING);
  }, [placementMemory, addLog, humorLevel]);

  // During placement, keep the console informed about the computer's preparations
  useEffect(() => {
    if (gamePhase !== GAME_PHASES.PLACEMENT) return;
    const count = placementMemory.length;
    setComputerDecision({
      thinking: `Observing your deployment. I am considering ${count} stored human board layout${count === 1 ? '' : 's'} for my defensive position.`,
      source: 'placement'
    });
  }, [gamePhase, placementMemory]);

  // Randomly place any ships not yet deployed, then start the game
  const handleRandomPlacement = useCallback(() => {
    if (!introTriggeredForGameRef.current) {
      introTriggeredForGameRef.current = true;
      const raw = sessionStorage.getItem('gameRunCount');
      let count = raw ? parseInt(raw, 10) : 0;
      count += 1;
      sessionStorage.setItem('gameRunCount', String(count));
      shouldPlayIntroRef.current = (count % 3 === 1);
    }
    if (shouldPlayIntroRef.current) {
      playSound('battleshipsintro.mp3');
      shouldPlayIntroRef.current = false;
    }

    const result = placeRemainingShipsRandomly(playerGrid, playerShipPositions, currentShipIndex);
    setPlayerGrid(result.grid);
    setPlayerShipPositions(result.shipPositions);
    setPlayerPlacedShips(result.shipPositions.map(s => s.name));
    setCurrentShipIndex(result.nextIndex);

    if (result.nextIndex < SHIPS.length) {
      addLog(`Random placement could not place all ships; ${SHIPS.length - result.nextIndex} remain. Please finish manually or try again.`);
      return;
    }

    startGame();
  }, [playerGrid, playerShipPositions, currentShipIndex, startGame, addLog, playSound]);

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

    fetchStats();
  }, [fetchStats]);

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
    })
      .then(() => fetchStats())
      .catch(err => addLog(`Failed to record layout: ${err.message || err}`));

    // Update local placement memory immediately for the next game
    setPlacementMemory(prev => updatePlacementMemory(prev, playerShipPositions, humanWon, 100));
  }, [winner, playerShipPositions, fetchStats, addLog]);

  // No intro restore on refresh: the per-tab game-run counter in sessionStorage
  // is used to play the intro once every 3 games instead.

  // Route grid clicks to placement or attack handlers based on game phase
  const handleCellClick = (row, col, isComputerGrid) => {
    if (!introTriggeredForGameRef.current) {
      introTriggeredForGameRef.current = true;
      const raw = sessionStorage.getItem('gameRunCount');
      let count = raw ? parseInt(raw, 10) : 0;
      count += 1;
      sessionStorage.setItem('gameRunCount', String(count));
      shouldPlayIntroRef.current = (count % 3 === 1);
    }
    if (shouldPlayIntroRef.current) {
      playSound('battleshipsintro.mp3');
      shouldPlayIntroRef.current = false;
    }

    if (gamePhase === GAME_PHASES.PLACEMENT && !isComputerGrid) {
      handlePlacement(row, col);
    } else if (gamePhase === GAME_PHASES.PLAYING && isPlayerTurn && isComputerGrid) {
      handlePlayerAttack(row, col);
    }
  };

  // Place the current ship on the player grid and advance to the next one
  const handlePlacement = (row, col) => {
    const ship = SHIPS[currentShipIndex];
    if (!ship) return;

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

    if (hit && newSunkShips.length === computerSunkShips.length) {
      playSound('hit.mp3');
    }

    if (newSunkShips.length > computerSunkShips.length) {
      playSound('sunk.mp3');
    }
    setComputerSunkShips(newSunkShips);

    if (checkWinCondition(newComputerGrid)) {
      playSound('welldoneadmiral.mp3');
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


  // Computer turn: ask the ensemble of experts for the best shot.
  const handleComputerAttack = () => {
    const boardKey = getBoardKey(computerMoves, playerShipPositions, playerSunkShips);
    const ensemble = getEnsembleMove({
      boardKey,
      weightMap,
      computerMoves,
      playerShipPositions,
      playerSunkShips,
      computerHuntTargets
    });

    if (!ensemble) {
      // No valid move left; should only happen at game-over.
      setIsPlayerTurn(true);
      return;
    }

    const { row, col, source, valueMap, winRate, topActions } = ensemble;

    // Reshape the 1D ensemble value map into the 2D heat map the grid renders.
    const newHeatMap = [];
    for (let r = 0; r < GRID_SIZE; r++) {
      const heatRow = [];
      for (let c = 0; c < GRID_SIZE; c++) {
        const i = r * GRID_SIZE + c;
        heatRow.push({
          attacked: boardKey[i] !== '0',
          value: valueMap[i],
          samples: 0
        });
      }
      newHeatMap.push(heatRow);
    }
    setHeatMap(newHeatMap);
    setFiredProbabilities(prev => ({
      ...prev,
      [`${row}-${col}`]: newHeatMap[row][col].value
    }));

    const thinking = getThinkingMessage(source, winRate, row, col, humorLevel);
    setComputerDecision({ row, col, boardKey, source, winRate, reason: thinking, topActions, thinking });
    addLog(thinking);
    addLog(`Target: [${row},${col}]`);

    const { grid: newPlayerGrid, hit } = processAttack(playerGrid, row, col);
    const updatedMoves = [...computerMoves, { row, col, hit }];

    setPlayerGrid(newPlayerGrid);
    setComputerMoves(updatedMoves);

    // Determine which ships are sunk before deciding whether to keep hunting
    const newSunkShips = checkSunkShips(playerShipPositions, updatedMoves);
    const hitShipSunk = hit && newSunkShips.some(name => {
      const ship = playerShipPositions.find(s => s.name === name);
      return ship && ship.positions.some(pos => pos.row === row && pos.col === col);
    });

    if (hit && !hitShipSunk) {
      playSound('hit.mp3');
    }

    if (hitShipSunk) {
      playSound('sunk.mp3');
    }
    setPlayerSunkShips(newSunkShips);

    if (hit) {
      if (hitShipSunk) {
        // Ship is fully sunk: drop out of hunt mode and revert to the normal
        // strategy (model / quartered / checkerboard) on the next turn.
        setComputerHuntTargets([]);
      } else {
        // Continue hunting the wounded ship, but strip any targets that belong
        // to already-sunk ships.
        const newTargets = getHuntDirectionTargets(row, col, computerMoves, playerShipPositions, playerSunkShips);
        setComputerHuntTargets(prev => {
          const combined = [...newTargets, ...prev];
          const deduped = combined.filter((target, index, self) =>
            index === self.findIndex(t => t.row === target.row && t.col === target.col) &&
            !updatedMoves.some(move => move.row === target.row && move.col === target.col)
          );
          return deduped.filter(target => !newSunkShips.some(name => {
            const sunkShip = playerShipPositions.find(ship => ship.name === name);
            return sunkShip && sunkShip.positions.some(pos => pos.row === target.row && pos.col === target.col);
          }));
        });
      }
    }

    if (checkWinCondition(newPlayerGrid)) {
      playSound('sunkbattleships.mp3');
      setWinner('computer');
      setGamePhase(GAME_PHASES.GAME_OVER);
      return;
    }

    // Personality-driven voiceovers
    computerTurnCountRef.current += 1;
    if (humorLevel >= 1) {
      // Pragmatic (0) never plays voiceovers.
      // Wry (1): once every ~50 turns, no earlier than turn 10.
      // Cheeky (2): once every ~20 turns, at least 10 turns after the last play.
      // Philosophical (3): once every ~15 turns, at least 5 turns after the last play.
      const { minGap, window } =
        humorLevel === 1 ? { minGap: 10, window: 41 } :     // 10-50 turns
        humorLevel === 2 ? { minGap: 10, window: 11 } :     // 10-20 turns
                          { minGap: 5, window: 11 };       // 5-15 turns
      if (nextVoiceoverTurnRef.current === null) {
        nextVoiceoverTurnRef.current = minGap + Math.floor(Math.random() * window);
      }
      if (computerTurnCountRef.current >= nextVoiceoverTurnRef.current) {
        playVoiceover();
        nextVoiceoverTurnRef.current = computerTurnCountRef.current + minGap + Math.floor(Math.random() * window);
      }
    }

    setIsPlayerTurn(true);
  };

  const resetGame = () => {
    introTriggeredForGameRef.current = false;
    shouldPlayIntroRef.current = false;
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
    setComputerDecision(null);
    setHeatMap(null);
    setFiredProbabilities({});
    computerTurnCountRef.current = 0;
    nextVoiceoverTurnRef.current = null;
  };

  return (
    <div className="screen-fit operations-room">
      <Header
        soundOn={soundOn}
        setSoundOn={setSoundOn}
        showInfoPanel={showInfoPanel}
        setShowInfoPanel={setShowInfoPanel}
      />
      
      <StatusBar
        gamePhase={gamePhase}
        currentShipIndex={currentShipIndex}
        orientation={orientation}
        setOrientation={setOrientation}
        handleRandomPlacement={handleRandomPlacement}
        isPlayerTurn={isPlayerTurn}
        winner={winner}
        resetGame={resetGame}
      />
      
      {/* Placement Instructions */}
      {gamePhase === GAME_PHASES.PLACEMENT && (
        <div className="text-center py-1">
          <span className="text-xs text-green-300 bg-gray-800/80 px-3 py-1 rounded border border-green-500/30 animate-pulse">
            {isMobile
              ? '🎯 Place ships in Friendly Waters'
              : '🎯 Place ships in Friendly Waters — R to rotate — Enter to randomize'}
          </span>
        </div>
      )}
      
      {/* Game Area */}
      <div className="game-area">
        {isMobile ? (
          /* Mobile layout: enemy waters, friendly waters, then the full tactical console */
          <div className="flex flex-col items-center gap-4 w-full">
            {gamePhase !== GAME_PHASES.PLACEMENT && (
              <GameGrid
                title="Enemy Waters"
                prompt={gamePhase === GAME_PHASES.PLAYING && playerMoves.length === 0 ? '🎯 Click any square to fire a missile' : null}
                grid={computerGrid}
                moves={playerMoves}
                shipPositions={computerShipPositions}
                sunkShips={computerSunkShips}
                placedShips={gamePhase === GAME_PHASES.PLAYING ? SHIPS.map(s => s.name) : []}
                isComputerGrid={true}
                revealShips={gamePhase === GAME_PHASES.GAME_OVER && winner === 'computer'}
                onCellClick={handleCellClick}
              />
            )}

            <GameGrid
              title="Friendly Waters"
              grid={playerGrid}
              moves={computerMoves}
              shipPositions={playerShipPositions}
              sunkShips={playerSunkShips}
              placedShips={playerPlacedShips}
              isComputerGrid={false}
              revealShips={false}
              onCellClick={handleCellClick}
            />

            {showInfoPanel && (
              <div className="w-full">
                <InfoPanel
                  humorLevel={humorLevel}
                  setHumorLevel={setHumorLevel}
                  computerDecision={computerDecision}
                  humanGames={humanGames}
                  syntheticGames={syntheticGames}
                  knownStates={knownStates}
                  consoleLog={consoleLog}
                  consoleFeedRef={consoleFeedRef}
                  heatMap={heatMap}
                  computerMoves={computerMoves}
                  firedProbabilities={firedProbabilities}
                  onClose={() => setShowInfoPanel(false)}
                />
              </div>
            )}
          </div>
        ) : (
          /* Desktop layout: friendly and enemy grids side by side with full console */
          <>
            <div className="flex flex-col md:flex-row items-start justify-center gap-4 md:gap-6 flex-1 min-w-0">
              {/* Player Grid */}
              <GameGrid
                title="Friendly Waters"
                grid={playerGrid}
                moves={computerMoves}
                shipPositions={playerShipPositions}
                sunkShips={playerSunkShips}
                placedShips={playerPlacedShips}
                isComputerGrid={false}
                revealShips={false}
                onCellClick={handleCellClick}
              />

              {/* Computer Grid */}
              {gamePhase !== GAME_PHASES.PLACEMENT && (
                <GameGrid
                  title="Enemy Waters"
                  prompt={gamePhase === GAME_PHASES.PLAYING && playerMoves.length === 0 ? '🎯 Click any square to fire a missile' : null}
                  grid={computerGrid}
                  moves={playerMoves}
                  shipPositions={computerShipPositions}
                  sunkShips={computerSunkShips}
                  placedShips={gamePhase === GAME_PHASES.PLAYING ? SHIPS.map(s => s.name) : []}
                  isComputerGrid={true}
                  revealShips={gamePhase === GAME_PHASES.GAME_OVER && winner === 'computer'}
                  onCellClick={handleCellClick}
                />
              )}
            </div>

            {/* Tactical info console */}
            {showInfoPanel && (
              <InfoPanel
                humorLevel={humorLevel}
                setHumorLevel={setHumorLevel}
                computerDecision={computerDecision}
                humanGames={humanGames}
                syntheticGames={syntheticGames}
                knownStates={knownStates}
                consoleLog={consoleLog}
                consoleFeedRef={consoleFeedRef}
                heatMap={heatMap}
                computerMoves={computerMoves}
                firedProbabilities={firedProbabilities}
                onClose={() => setShowInfoPanel(false)}
              />
            )}
          </>
        )}
      </div>
      
      {/* Legend */}
      <div className="h-12 flex items-center justify-center gap-4 operations-panel rounded-lg px-4 shrink-0">
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
        <div
          className="fixed top-16 left-1/2 z-50 w-auto max-w-lg cursor-move select-none"
          style={{ transform: `translate(calc(-50% + ${bannerOffset.x}px), ${bannerOffset.y}px)` }}
          onMouseDown={handleBannerMouseDown}
          onTouchStart={handleBannerTouchStart}
        >
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