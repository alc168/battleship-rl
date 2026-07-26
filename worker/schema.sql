CREATE TABLE IF NOT EXISTS layouts (
  layout_json TEXT PRIMARY KEY,
  wins INTEGER DEFAULT 0,
  games INTEGER DEFAULT 0,
  win_rate REAL DEFAULT 0.0,
  last_played INTEGER
);

CREATE INDEX IF NOT EXISTS idx_layouts_win_rate ON layouts(win_rate DESC, games DESC, last_played DESC);

CREATE TABLE IF NOT EXISTS rate_limits (
  ip TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (ip, window_start)
);
