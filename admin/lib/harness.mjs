import { strict as assert } from 'node:assert/strict';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const reportsDir = join(__dirname, '..', 'reports');

let tests = [];

export function test(name, fn, options = {}) {
  if (typeof fn !== 'function') {
    throw new Error('test() requires a function');
  }
  tests.push({ name, fn, options });
}

test.skip = function (name, fn, options = {}) {
  tests.push({ name, fn, options, skip: true });
};

export function expect(actual) {
  return {
    toBe(expected) {
      assert.strictEqual(actual, expected);
    },
    toEqual(expected) {
      assert.deepStrictEqual(actual, expected);
    },
    toBeGreaterThan(expected) {
      assert.ok(actual > expected, `expected ${actual} to be greater than ${expected}`);
    },
    toBeGreaterThanOrEqual(expected) {
      assert.ok(actual >= expected, `expected ${actual} to be >= ${expected}`);
    },
    toBeLessThan(expected) {
      assert.ok(actual < expected, `expected ${actual} to be less than ${expected}`);
    },
    toBeTruthy() {
      assert.ok(actual);
    },
    toBeFalsy() {
      assert.ok(!actual);
    },
    toBeDefined() {
      assert.notStrictEqual(actual, undefined);
    },
    toBeNull() {
      assert.strictEqual(actual, null);
    },
    toContain(item) {
      assert.ok(actual.includes(item), `expected ${JSON.stringify(actual)} to contain ${JSON.stringify(item)}`);
    },
    toThrow(fn) {
      assert.throws(fn);
    },
    toBeInstanceOf(cls) {
      assert.ok(actual instanceof cls);
    },
    toHaveLength(n) {
      assert.strictEqual(actual.length, n);
    },
    toHaveProperty(key) {
      assert.ok(Object.prototype.hasOwnProperty.call(actual, key), `expected object to have property ${key}`);
    }
  };
}

function loadDotenv() {
  const envPath = join(__dirname, '..', '.env');
  if (!existsSync(envPath)) return;
  const content = readFileSync(envPath, 'utf8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim().replace(/^["']|["']$/g, '');
    if (!process.env[key]) process.env[key] = value;
  }
}

function nowISO() {
  return new Date().toISOString();
}

export function getEnv(key, fallback = '') {
  return process.env[key] ?? fallback;
}

function formatDuration(ms) {
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(2)}s`;
}

function buildReport(startedAt, results, totalDuration) {
  const passed = results.filter(r => r.status === 'PASS').length;
  const failed = results.filter(r => r.status === 'FAIL').length;
  const skipped = results.filter(r => r.status === 'SKIP').length;
  const apiBaseUrl = getEnv('API_BASE_URL', 'https://battleship-rl-api.battleship-rl.workers.dev');
  const apiKeyPresent = !!getEnv('API_KEY');

  const lines = [
    '# Battleship RL — Admin Test Report',
    '',
    `**Generated:** ${nowISO()}`,
    `**Duration:** ${formatDuration(totalDuration)}`,
    `**API base URL:** ${apiBaseUrl}`,
    `**API key configured:** ${apiKeyPresent ? 'Yes' : 'No'}`,
    '',
    '## Summary',
    '',
    '| Metric | Value |',
    '|--------|-------|',
    `| Total tests | ${results.length} |`,
    `| Passed | ${passed} |`,
    `| Failed | ${failed} |`,
    `| Skipped | ${skipped} |`,
    '',
    '## Results',
    '',
    '| Status | Test | Component | SOC 2 control | Duration | Evidence |',
    '|--------|------|-----------|---------------|----------|----------|'
  ];

  for (const r of results) {
    const component = r.options.component || 'General';
    const control = r.options.control || 'CC7.2';
    const evidence = r.error ? `Failure: ${r.error.split('\n')[0]}` : 'Passed';
    const icon = r.status === 'PASS' ? 'PASS' : r.status === 'FAIL' ? 'FAIL' : 'SKIP';
    lines.push(`| ${icon} | ${r.name} | ${component} | ${control} | ${formatDuration(r.duration)} | ${evidence.replace(/\|/g, '\\|')} |`);
  }

  if (failed > 0) {
    lines.push('', '## Failures', '');
    for (const r of results.filter(r => r.status === 'FAIL')) {
      lines.push(`### ${r.name}`, '', '```', r.error, '```', '');
    }
  }

  lines.push(
    '',
    '## SOC 2 Type 2 Considerations',
    '',
    'This test suite is designed to provide evidence for common SOC 2 control objectives:',
    '',
    '- **CC6.1 / CC6.2 (Logical access):** API key is required for all write endpoints.',
    '- **CC6.6 (Security infrastructure):** CORS is restricted to known origins and invalid payloads are rejected.',
    '- **CC7.1 / CC7.2 (System operations):** Health checks confirm D1, KV, and the Worker are available.',
    '- **CC7.3 (System monitoring):** Rate limiting is enforced on write endpoints.',
    '- **A1.2 (Availability):** Endpoints respond and the GitHub Pages front-end loads.',
    '',
    '## Recommendations',
    '',
    '1. Run this suite before each release or after any Worker/frontend change.',
    '2. Review any `FAIL` rows immediately; `SKIP` rows indicate missing test prerequisites (e.g., `API_KEY`).',
    '3. Store historical reports in `admin/reports/` for an audit trail.',
    '4. For SOC 2 Type 2, run the suite at least weekly and retain results.',
    ''
  );

  return lines.join('\n');
}

export async function run() {
  loadDotenv();
  const startedAt = nowISO();
  const start = Date.now();
  const results = [];

  for (const t of tests) {
    const t0 = Date.now();
    if (t.skip) {
      results.push({ name: t.name, status: 'SKIP', duration: 0, options: t.options, error: null });
      continue;
    }
    try {
      await t.fn();
      results.push({ name: t.name, status: 'PASS', duration: Date.now() - t0, options: t.options, error: null });
    } catch (err) {
      results.push({ name: t.name, status: 'FAIL', duration: Date.now() - t0, options: t.options, error: err.stack || err.message });
    }
  }

  const totalDuration = Date.now() - start;
  const report = buildReport(startedAt, results, totalDuration);
  const jsonReport = {
    generatedAt: startedAt,
    durationMs: totalDuration,
    summary: {
      total: results.length,
      passed: results.filter(r => r.status === 'PASS').length,
      failed: results.filter(r => r.status === 'FAIL').length,
      skipped: results.filter(r => r.status === 'SKIP').length
    },
    environment: {
      apiBaseUrl: getEnv('API_BASE_URL', 'https://battleship-rl-api.battleship-rl.workers.dev'),
      apiKeyPresent: !!getEnv('API_KEY')
    },
    results
  };

  await mkdir(reportsDir, { recursive: true });
  await writeFile(join(reportsDir, 'latest.json'), JSON.stringify(jsonReport, null, 2));
  await writeFile(join(reportsDir, 'latest.md'), report);

  console.log(`\n${jsonReport.summary.passed}/${jsonReport.summary.total} passed in ${formatDuration(totalDuration)}`);
  if (jsonReport.summary.failed) console.log(`${jsonReport.summary.failed} failed`);
  if (jsonReport.summary.skipped) console.log(`${jsonReport.summary.skipped} skipped`);

  return results;
}
