const HUMOR_LABELS = ['Pragmatic', 'Wry', 'Cheeky', 'Philosophical'];

export function InfoPanel({
  humorLevel,
  setHumorLevel,
  computerDecision,
  humanGames,
  syntheticGames,
  knownStates,
  consoleLog,
  consoleFeedRef,
  heatMap,
  computerMoves,
  firedProbabilities,
  onClose
}) {
  const topActions = computerDecision?.topActions || [];

  const renderHeatmap = () => (
    <div className="info-section">
      <div className="info-section-title">Firing Probability Heatmap</div>
      <div className="heatmap-grid">
        {heatMap && heatMap.map((row, r) =>
          row.map((cell, c) => {
            const attacked = computerMoves.some((m) => m.row === r && m.col === c);
            const prob = attacked ? (firedProbabilities[`${r}-${c}`] ?? cell.value) : cell.value;
            const clamped = Math.min(Math.max(prob, 0), 1);
            const hue = 200 - clamped * 160; // cyan (200) -> red (40)
            const bg = `hsl(${hue}, ${attacked ? '70%' : '100%'}, ${attacked ? '35%' : '50%'})`;
            const label = `${Math.round(clamped * 100)}`;
            return (
              <div
                key={`heat-${r}-${c}`}
                className="heatmap-cell"
                style={{ backgroundColor: bg }}
                title={`[${r},${c}] ${attacked ? 'fired at' : 'current'} probability: ${label}%`}
              >
                {label}
              </div>
            );
          })
        )}
      </div>
      <div className="text-[10px] text-cyan-400/60 mt-1 text-center">
        Overlay shows the AI's estimated win probability for each friendly cell.
      </div>
    </div>
  );

  return (
    <div className="info-panel">
      <div className="info-panel-header">
        <span className="text-cyan-300 font-bold tracking-widest text-xs">COMPUTER TACTICAL CONSOLE</span>
        <button
          onClick={onClose}
          className="text-cyan-500 hover:text-cyan-300 text-xs"
          aria-label="Close tactical console"
        >
          [ CLOSE ]
        </button>
      </div>

      <div className="info-panel-content">
        {/* Left column: personality, thinking, stats, log */}
        <div className="flex flex-col gap-3">
          {/* Humour dial */}
          <div className="info-section">
            <div className="info-section-title">Computer Personality</div>
            <div className="flex items-center gap-2">
              <input
                id="humor-range"
                type="range"
                min="0"
                max="3"
                step="1"
                value={humorLevel}
                onChange={(e) => setHumorLevel(parseInt(e.target.value, 10))}
                className="w-full accent-cyan-400"
                aria-label="Humour level"
              />
            </div>
            <div className="flex justify-between text-[10px] text-cyan-300/70 mt-1">
              {HUMOR_LABELS.map((label, i) => (
                <span key={label} className={i === humorLevel ? 'text-cyan-100 font-bold' : ''}>{label}</span>
              ))}
            </div>
          </div>

          {/* Current computer thinking */}
          <div className="info-section">
            <div className="info-section-title">Current Thinking</div>
            {computerDecision ? (
              <div className="text-xs italic text-cyan-100 whitespace-pre-line leading-relaxed">
                {computerDecision.thinking}
              </div>
            ) : (
              <div className="text-cyan-600/60 text-xs italic">The opponent is gathering itself...</div>
            )}
          </div>

          {/* Game statistics */}
          <div className="info-section">
            <div className="info-section-title">Combat Record</div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="text-cyan-300/80">Human games:</div>
              <div className="text-cyan-100 text-right">{humanGames}</div>
              <div className="text-cyan-300/80">Synthetic games:</div>
              <div className="text-cyan-100 text-right">{syntheticGames}</div>
              <div className="text-cyan-300/80">Known states:</div>
              <div className="text-cyan-100 text-right">{knownStates}</div>
            </div>
          </div>

          {/* Live console feed */}
          <div className="info-section">
            <div className="info-section-title">Training &amp; Event Log</div>
            <div ref={consoleFeedRef} className="console-feed">
              {consoleLog.length === 0 ? (
                <div className="text-cyan-600/60 text-xs italic">Awaiting telemetry...</div>
              ) : (
                [...consoleLog].reverse().map((line, i) => {
                  const originalIndex = consoleLog.length - 1 - i;
                  return <div key={`log-${originalIndex}`} className="console-line">{line}</div>;
                })
              )}
            </div>
          </div>
        </div>

        {/* Right column: heatmap, recommendations, decision */}
        <div className="flex flex-col gap-3">
          {/* Probability heatmap */}
          {renderHeatmap()}

          {/* Top recommendations */}
          {topActions.length > 0 && (
            <div className="info-section">
              <div className="info-section-title">Top Recommendations</div>
              {topActions.map((action, i) => (
                <div key={`rec-${i}`} className="text-[10px] font-mono text-cyan-200/80">
                  #{i + 1}: [{action[0]},{action[1]}] win {(action[2] * 100).toFixed(1)}% (n={action[4]})
                </div>
              ))}
            </div>
          )}

          {/* Last computer decision */}
          <div className="info-section">
            <div className="info-section-title">Last Enemy Decision</div>
            {computerDecision && typeof computerDecision.row === 'number' ? (
              <div className="text-xs space-y-1">
                <div className="text-cyan-300">Target: <span className="text-white">[{computerDecision.row},{computerDecision.col}]</span></div>
                <div className="text-cyan-300/80">Source: <span className="text-cyan-100 uppercase">{computerDecision.source}</span></div>
                <div className="text-cyan-300/60 font-mono text-[10px] break-all">State: {computerDecision.boardKey}</div>
              </div>
            ) : (
              <div className="text-cyan-600/60 text-xs italic">No enemy action recorded yet.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
