import { run } from './lib/harness.mjs';
import './tests/utils.test.mjs';
import './tests/training.test.mjs';
import './tests/api.test.mjs';
import './tests/security.test.mjs';

const results = await run();
const failed = results.filter(r => r.status === 'FAIL').length;
process.exit(failed ? 1 : 0);
