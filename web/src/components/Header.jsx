import { APP_VERSION } from '../constants.js';

export function Header({ soundOn, setSoundOn, showInfoPanel, setShowInfoPanel }) {
  return (
    <div className="flex flex-col sm:flex-row items-center justify-between gap-2 px-4 py-2 shrink-0 operations-panel rounded-lg">
      <div className="flex items-baseline gap-2">
        <h1 className="text-xl sm:text-2xl font-bold text-green-400 tracking-wider font-mono">
          Battleships - RL
        </h1>
        <span className="text-[10px] text-green-600 font-mono">v{APP_VERSION}</span>
      </div>
      <div className="flex items-center gap-2 text-xs text-green-600 font-mono">
        <button
          onClick={() => setSoundOn((prev) => !prev)}
          className="tactical-button p-2 rounded"
          aria-label={soundOn ? 'Turn sound off' : 'Turn sound on'}
        >
          <svg viewBox="0 0 24 24" className="w-4 h-4" aria-hidden="true">
            {soundOn ? (
              <>
                <path d="M3 9v6h4l5 4V5L7 9H3z" fill="currentColor" className="text-green-300" />
                <path
                  d="M15 10.5a3 3 0 0 1 0 3M18.5 7.5a7 7 0 0 1 0 9"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  className="text-green-300"
                />
              </>
            ) : (
              <>
                <path d="M3 9v6h4l5 4V5L7 9H3z" fill="currentColor" className="text-green-300" />
                <circle cx="12" cy="12" r="9" fill="none" stroke="#ef4444" strokeWidth="2" />
                <line x1="6" y1="6" x2="18" y2="18" stroke="#ef4444" strokeWidth="2" strokeLinecap="round" />
              </>
            )}
          </svg>
        </button>
        <button
          onClick={() => setShowInfoPanel((prev) => !prev)}
          className="tactical-button px-3 py-2 rounded text-xs uppercase tracking-wider"
          aria-label={showInfoPanel ? 'Close computer tactical console' : 'Open computer tactical console'}
        >
          {showInfoPanel ? 'Close Console' : 'Console'}
        </button>
      </div>
    </div>
  );
}
