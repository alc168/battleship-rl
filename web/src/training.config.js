/**
 * Training hyperparameters for the in-browser Web Worker.
 *
 * COST_FIRST   — one KV write per 1,000 games, smaller maps, throttled updates.
 *                Best for keeping Cloudflare usage as close to free as possible.
 *
 * EXPERIENCE_FIRST — more frequent feedback, larger maps, smoother UI updates.
 *                Uses more KV writes and storage for better responsiveness.
 */

export const PRESETS = {
  COST_FIRST: {
    GAMES_PER_BATCH: 250,           // larger batch; one KV write per batch
    CHUNK_SIZE: 50,                 // report progress every 50 games
    UPLOAD_INTERVAL_BATCHES: 1,     // one API write per completed batch
    MAX_ACTIONS_PER_STATE: 20,      // more candidate cells per known state
    MIN_SAMPLES_PER_ACTION: 3,      // keep actions but require minimal evidence
    MAX_STATES: 20000,              // hard cap on stored board states
    PRUNE_STATES_THRESHOLD: 25000,  // start pruning when above this
    EXPLORATION_EPSILON: 0.25,      // cheaper because it explores more randomly
    MAX_WORKER_MS: 30000,           // allow longer chunks to reduce overhead
    TRAINING_DELAY_MS: 0,           // start training as soon as the game begins
    CONTINUOUS_INTERVAL_MS: 5000,   // wait 5 seconds between continuous batches
    ENABLE_ON_MOBILE: false         // skip on mobile to save battery
  },
  EXPERIENCE_FIRST: {
    GAMES_PER_BATCH: 250,
    CHUNK_SIZE: 50,
    UPLOAD_INTERVAL_BATCHES: 1,
    MAX_ACTIONS_PER_STATE: 20,
    MIN_SAMPLES_PER_ACTION: 3,
    MAX_STATES: 100000,
    PRUNE_STATES_THRESHOLD: 120000,
    EXPLORATION_EPSILON: 0.10,
    MAX_WORKER_MS: 15000,
    TRAINING_DELAY_MS: 0,
    CONTINUOUS_INTERVAL_MS: 2000,
    ENABLE_ON_MOBILE: true
  }
};

const mode = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_TRAINING_MODE) || 'COST_FIRST';
export const CONFIG = PRESETS[mode] || PRESETS.COST_FIRST;
