import { GAME_PHASES, ORIENTATIONS, SHIPS } from '../constants.js';

export function StatusBar({
  gamePhase,
  currentShipIndex,
  orientation,
  setOrientation,
  handleRandomPlacement,
  isPlayerTurn,
  winner,
  resetGame
}) {
  return (
    <div className="status-bar">
      <div className="flex items-center gap-4 flex-wrap justify-center sm:justify-start">
        {gamePhase === GAME_PHASES.PLACEMENT && (
          <>
            <span className="text-green-300 text-sm">
              DEPLOY: {SHIPS[currentShipIndex]?.name} ({SHIPS[currentShipIndex]?.size})
            </span>
            <button
              onClick={() =>
                setOrientation(
                  orientation === ORIENTATIONS.HORIZONTAL
                    ? ORIENTATIONS.VERTICAL
                    : ORIENTATIONS.HORIZONTAL
                )
              }
              className="tactical-button px-3 py-1 rounded text-xs"
            >
              {orientation === 'horizontal' ? 'HORIZ' : 'VERT'}
            </button>
            <button
              onClick={handleRandomPlacement}
              disabled={currentShipIndex >= SHIPS.length}
              className="tactical-button px-3 py-1 rounded text-xs disabled:opacity-50 disabled:cursor-not-allowed"
            >
              🎲 RANDOM
            </button>
          </>
        )}
        {gamePhase === GAME_PHASES.PLAYING && (
          <span className="text-green-300 text-sm">
            {isPlayerTurn ? '⚔️ YOUR TURN' : '🤖 ENEMY TURN'}
          </span>
        )}
        {gamePhase === GAME_PHASES.GAME_OVER && (
          <span
            className={`text-sm font-bold ${
              winner === 'player' ? 'text-green-400' : 'text-red-400'
            }`}
          >
            {winner === 'player' ? '🎉 MISSION ACCOMPLISHED' : '💥 MISSION FAILED'}
          </span>
        )}
      </div>

      <div className="flex items-center gap-2">
        <button onClick={resetGame} className="tactical-button px-3 py-1 rounded text-xs">
          🔄 RESET
        </button>
        {gamePhase === GAME_PHASES.GAME_OVER && (
          <button onClick={resetGame} className="tactical-button px-3 py-1 rounded text-xs">
            🎯 NEW MISSION
          </button>
        )}
      </div>
    </div>
  );
}
