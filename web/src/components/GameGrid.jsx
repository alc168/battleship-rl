import { CELL_STATES, GRID_SIZE, SHIPS } from '../constants.js';

export function GameGrid({
  title,
  prompt,
  grid,
  moves,
  shipPositions,
  sunkShips,
  placedShips,
  isComputerGrid,
  revealShips,
  onCellClick
}) {
  const isCellOfSunkShip = (row, col) => {
    return shipPositions.some(
      (ship) =>
        sunkShips.includes(ship.name) &&
        ship.positions.some((pos) => pos.row === row && pos.col === col)
    );
  };

  const getCellClass = (cellState, row, col) => {
    let baseClass = 'w-6 h-6 border flex items-center justify-center cursor-pointer relative overflow-hidden';
    const isSunk = isCellOfSunkShip(row, col);
    const move = moves.find((m) => m.row === row && m.col === col);

    if (isComputerGrid) {
      if (move) {
        if (isSunk) {
          baseClass += ' sunk-cell border-red-700';
        } else if (move.hit) {
          baseClass += ' hit-cell border-red-500';
        } else {
          baseClass += ' miss-cell border-yellow-400';
        }
      } else if (revealShips && cellState === CELL_STATES.SHIP) {
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

    const shouldGlow = isComputerGrid && move;
    if (shouldGlow) {
      baseClass += isSunk ? ' radar-glow-sunk' : ' radar-glow';
    }

    return baseClass;
  };

  const getCellContent = (row, col) => {
    const isSunk = isCellOfSunkShip(row, col);
    const move = moves.find((m) => m.row === row && m.col === col);

    if (move && !move.hit) {
      return <span className="text-yellow-900 font-bold text-sm">×</span>;
    }
    if (move && move.hit && isSunk) {
      return <span className="skull-icon">☠</span>;
    }
    return null;
  };

  const renderShipIcon = (size, isSunk) => {
    const squares = Array.from({ length: size }, (_, i) => (
      <div
        key={i}
        className={`w-1.5 h-3 rounded-sm ${isSunk ? 'bg-red-600' : 'bg-gray-500'}`}
      ></div>
    ));
    return <div className="flex gap-0.5 items-center">{squares}</div>;
  };

  const renderShipStatus = () => (
    <div className="operations-panel rounded-lg p-2 w-full">
      <h3 className="text-xs font-semibold text-green-400 mb-2 uppercase tracking-wider">
        {isComputerGrid ? 'Enemy Contacts' : 'Friendly Fleet'}
      </h3>
      <div className="grid grid-cols-2 gap-1">
        {SHIPS.map((ship, index) => {
          const isSunk = sunkShips.includes(ship.name);
          const isPlaced = placedShips.includes(ship.name);
          let status = 'pending';
          if (isSunk) status = 'sunk';
          else if (isPlaced) status = 'operational';

          return (
            <div
              key={`${isComputerGrid ? 'enemy' : 'player'}-${index}-${ship.name}-${status}`}
              className={`ship-status-compact ${status}`}
            >
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

  return (
    <div className="flex flex-col items-center gap-2 w-full">
      <h3 className="text-sm font-semibold text-green-400 uppercase tracking-wider">
        {title}
      </h3>
      {prompt && (
        <div className="text-xs text-green-300 bg-gray-800/80 px-3 py-1 rounded border border-green-500/30 animate-pulse">
          {prompt}
        </div>
      )}

      <div className="flex flex-col gap-0.5">
        <div className="flex justify-center gap-0.5 mb-0.5">
          <div className="w-5"></div>
          {Array.from({ length: GRID_SIZE }, (_, i) => (
            <div key={`col-${isComputerGrid ? 'enemy' : 'player'}-${i}`} className="coordinate-label text-center py-0.5 w-5">
              {String.fromCharCode(65 + i)}
            </div>
          ))}
        </div>

        <div className="flex gap-0.5">
          <div className="flex flex-col gap-0.5 mr-0.5">
            {Array.from({ length: GRID_SIZE }, (_, i) => (
              <div key={`row-${isComputerGrid ? 'enemy' : 'player'}-${i}`} className="coordinate-label text-center py-1.5 w-5">
                {i + 1}
              </div>
            ))}
          </div>

          <div className="relative grid grid-cols-10 gap-0 border-2 border-green-500/30 rounded-lg overflow-hidden radar-grid">
            {isComputerGrid && <div className="radar-sweep"></div>}
            {grid.map((row, rowIndex) =>
              row.map((cell, colIndex) => (
                <div
                  key={`${isComputerGrid ? 'enemy' : 'player'}-${rowIndex * GRID_SIZE + colIndex}`}
                  className={getCellClass(cell, rowIndex, colIndex)}
                  onClick={() => onCellClick(rowIndex, colIndex, isComputerGrid)}
                >
                  {getCellContent(rowIndex, colIndex)}
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {renderShipStatus()}
    </div>
  );
}
