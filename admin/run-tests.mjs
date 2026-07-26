import { loadDotenv, run } from './lib/harness.mjs';

// Load environment variables before test modules register, so API_KEY is available.
loadDotenv();

await import('./tests/utils.test.mjs');
await import('./tests/utils-coverage.test.mjs');
await import('./tests/training.test.mjs');
await import('./tests/api.test.mjs');
await import('./tests/security.test.mjs');

const results = await run();
const failed = results.filter(r => r.status === 'FAIL').length;
process.exit(failed ? 1 : 0);
