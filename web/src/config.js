/**
 * Runtime configuration for the Battleship RL web app.
 *
 * Set VITE_API_BASE_URL and VITE_TRAINING_MODE in a .env file or your build command:
 *
 *   VITE_API_BASE_URL=https://battleship-rl-api.your-account.workers.dev
 *   VITE_TRAINING_MODE=COST_FIRST
 */

export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8787';
export const TRAINING_MODE = import.meta.env.VITE_TRAINING_MODE || 'COST_FIRST';
