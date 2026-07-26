import { getCheckerboardMove } from '../web/src/utils.js';
import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const policyPath = join(__dirname, '..', 'ai_policy.json');

console.log('Loading ai_policy.json...');
const policy = JSON.parse(readFileSync(policyPath, 'utf8'));
const total = Object.keys(policy).length;

const filtered = {};
let kept = 0;
let removed = 0;

for (const [key, actions] of Object.entries(policy)) {
  if (key === 'empty_board') {
    // Handle below so we can compare it to the hardcoded empty-board move.
    continue;
  }

  const top = actions?.[0];
  if (!top || !Array.isArray(top) || top.length < 2) {
    removed++;
    continue;
  }

  const cb = getCheckerboardMove(key);
  if (!cb || (top[0] === cb.row && top[1] === cb.col)) {
    removed++;
    continue;
  }

  // Store only the top override action; the checkerboard fallback covers the rest.
  filtered[key] = [top];
  kept++;
}

// Only keep empty_board if its first recommendation differs from the checkerboard opening.
if (policy['empty_board']) {
  const emptyKey = '0'.repeat(100);
  const cbEmpty = getCheckerboardMove(emptyKey);
  const top = policy['empty_board'][0];
  if (!cbEmpty || top[0] !== cbEmpty.row || top[1] !== cbEmpty.col) {
    filtered['empty_board'] = [top];
    kept++;
  } else {
    removed++;
  }
}

console.log(`Total entries: ${total}`);
console.log(`Kept: ${kept}`);
console.log(`Removed: ${removed}`);

// Backup the original for safety before overwriting.
renameSync(policyPath, `${policyPath}.backup`);
writeFileSync(policyPath, JSON.stringify(filtered));
console.log(`Wrote filtered policy to ${policyPath}`);
