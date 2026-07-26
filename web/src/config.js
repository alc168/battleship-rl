/**
 * Runtime configuration for the Battleship RL web app.
 *
 * Set VITE_API_BASE_URL, VITE_API_KEY and VITE_TRAINING_MODE in a .env file or your build command:
 *
 *   VITE_API_BASE_URL=https://battleship-rl-api.your-account.workers.dev
 *   VITE_API_KEY=your-shared-api-key
 *   VITE_TRAINING_MODE=COST_FIRST
 */

const PROD_API_URL = 'https://battleship-rl-api.battleship-rl.workers.dev';
export const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || (import.meta.env.PROD ? PROD_API_URL : 'http://localhost:8787')).replace(/\/$/, '');
export const API_KEY = import.meta.env.VITE_API_KEY || '';
export const TRAINING_MODE = import.meta.env.VITE_TRAINING_MODE || 'COST_FIRST';
