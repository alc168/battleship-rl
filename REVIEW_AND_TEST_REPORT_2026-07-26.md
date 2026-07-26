# Battleship RL — Review, Test and Lint Report

**Date:** 2026-07-26  
**Scope:** `web/`, `worker/`, `admin/`  
**Reviewer:** Devin

---

## 1. Executive Summary

This report documents a test, lint, and code-review pass after the recent KV-usage throttling work. The application builds, the Worker is deployed, and all runnable tests pass. Four lint warnings were raised across `worker/` and `admin/`, all for unused identifiers. No runtime errors were found. The main reliability observation is that `EXPERIENCE_FIRST` training mode is still aggressive and should not be used on the Workers Free plan.

---

## 2. Test Run

Command run:

```bash
cd /Users/jeremy/battleships-rl/admin
npm test
```

### 2.1 Results

| Metric | Value |
|--------|-------|
| Total tests | 36 |
| Passed | 28 |
| Failed | 0 |
| Skipped | 8 |
| Duration | 4.76 s |
| API key configured | No |

The full machine-readable report is in `admin/reports/latest.json` and the rendered Markdown summary is in `admin/reports/latest.md`.

### 2.2 Skipped tests

Eight `authTest`-wrapped tests were skipped because `admin/.env` does not contain a valid `API_KEY`. These cover:

- `POST /api/record` authentication and validation
- `POST /api/merge-weights` authentication and validation
- rate-limiting behaviour on `/api/record`

To enable them, copy `admin/.env.example` to `admin/.env` and set the real `API_KEY` that is configured as a Cloudflare Worker secret.

---

## 3. Lint / Static Analysis

### 3.1 `web/src`

Command:

```bash
cd /Users/jeremy/battleships-rl/web
npx oxlint src/
```

Result: **0 warnings, 0 errors** on 14 files with 91 rules.

### 3.2 `worker/` and `admin/`

Command:

```bash
cd /Users/jeremy/battleships-rl
./web/node_modules/.bin/oxlint worker admin
```

Result: **4 warnings, 0 errors**.

| File | Line | Identifier | Issue |
|------|------|------------|-------|
| `admin/tests/utils.test.mjs` | 18 | `seedPlacementMemory` | Imported but never used |
| `worker/index.js` | 183 | `ctx` | Third parameter of `fetch` is unused |
| `admin/tests/security.test.mjs` | 1 | `harnessTest` | Aliased import `test as harnessTest` is never used |
| `admin/lib/harness.mjs` | 2 | `readFile` | Imported from `node:fs/promises` but never used |

All four are clean-up items, not bugs.

---

## 4. Code Review Findings

### 4.1 What is already in good shape

| Area | Observation |
|------|-------------|
| **API key comparison** | `worker/index.js` uses `crypto.subtle.timingSafeEqual` (`checkApiKey`), avoiding timing side-channels. |
| **CORS** | Origin checks are enforced for `OPTIONS` and `POST` requests; `Access-Control-Allow-Origin` is set only for allowed origins. |
| **Input validation** | `validateLayout`, `validateDelta`, and `validate...` helpers reject malformed or oversized payloads before touching storage. |
| **Rate limiting** | Per-IP rate limits are backed by D1, not memory, so they are consistent across Worker isolates. |
| **Payload size check** | `validateDelta` measures serialized bytes with `new TextEncoder().encode(JSON.stringify(delta)).length` rather than string length. |
| **KV throttling** | Recent changes batch training uploads every 10 batches and wait 30 seconds between continuous batches, keeping usage inside the Free tier. |
| **Secret handling** | `API_KEY` is not in source or wrangler config; it is expected to be a Worker secret. |
| **D1 queries** | SQL statements use parameterized bindings, mitigating injection. |

### 4.2 Minor issues and dead code

1. **Unused `seedPlacementMemory` import in `admin/tests/utils.test.mjs`**  
   The import is not used in the test file and should be removed to keep the test suite clean.

2. **Unused `readFile` import in `admin/lib/harness.mjs`**  
   `readFile` is imported from `node:fs/promises` but never referenced. `readFileSync` from `node:fs` is used instead.

3. **Unused `harnessTest` alias in `admin/tests/security.test.mjs`**  
   The file imports `test as harnessTest` but only uses `test`. The alias can be removed.

4. **Unused `ctx` parameter in `worker/index.js`**  
   The Worker `fetch` handler declares `ctx` but never uses it. This is a convention in the Workers runtime and can be left as-is, renamed to `_ctx`, or used to register `ctx.waitUntil` for any future background work.

### 4.3 Reliability and operational notes

1. **`EXPERIENCE_FIRST` is still expensive**  
   `web/src/training.config.js` defines `EXPERIENCE_FIRST` with `UPLOAD_INTERVAL_BATCHES: 1` and `CONTINUOUS_INTERVAL_MS: 2000`. Using this mode on the Free plan will still exhaust the KV write quota quickly. Consider raising `UPLOAD_INTERVAL_BATCHES` and `CONTINUOUS_INTERVAL_MS` for this preset, or documenting that it is intended for paid plans only.

2. **Pending delta is reset even on upload failure**  
   `web/src/App.jsx` now accumulates training deltas and flushes them in batches. The `.finally()` handler clears the pending buffer after every upload attempt, whether or not it succeeded. A failed network call will therefore lose the accumulated training data for that batch. Consider clearing only on success, or adding a retry/backoff for transient failures.

3. **Optional API key means open write endpoints if unset**  
   In `worker/index.js`, `checkApiKey` returns `true` when `env.API_KEY` is not configured. This is convenient for local development but means a production Worker accidentally deployed without the secret will accept unauthenticated writes. Consider adding a startup warning or making the key required once deployed.

4. **Origin list includes `localhost`**  
   `wrangler.toml` sets `ALLOWED_ORIGINS` to `"https://alc168.github.io,http://localhost:5173"`. The `localhost` entry should be removed from the production wrangler config to avoid allowing arbitrary local dev clients to call the live API.

5. **`/api/stats` still reads KV twice per call**  
   Each stats request does `env.KV.get('synthetic_games')` and `env.KV.get('weight_map')`. After the recent changes this is no longer called after every training upload, but it is still called on page load and after each human game. If traffic grows, consider caching the stats response in KV itself, or moving `synthetic_games` to D1 so `/api/stats` only reads one KV key.

6. **`/api/record` DELETE is expensive at scale**  
   Every recorded game triggers a `DELETE ... NOT IN (SELECT ... ORDER BY ... LIMIT 10000)` batch. This keeps the table bounded but scans the whole table each time. For now the table is small; if it grows, consider a periodic cleanup cron/scheduled Worker instead of pruning on every write.

---

## 5. Security Review

| Control | Status | Notes |
|---------|--------|-------|
| Authentication on write endpoints | OK | `checkApiKey` with `timingSafeEqual`. |
| CORS restriction | OK | Allowed origins are explicit; `OPTIONS` and `POST` are checked. |
| Rate limiting | OK | D1-backed, per-IP, 60-second windows, 30 req/min. |
| Input validation | OK | Layout length, delta size, action shape, and CORS preflight are validated. |
| SQL injection | OK | D1 queries use parameter binding. |
| Secret management | OK | `API_KEY` is a Worker secret, not in source. |
| Timing side-channels | OK | API key and length are compared with `timingSafeEqual`. |
| Production hardening | Review | Remove `localhost` from `ALLOWED_ORIGINS`; ensure `API_KEY` is set in production. |

---

## 6. Recommendations

1. **Clean up the four lint warnings** (remove unused imports/aliases or prefix unused parameters with `_`).
2. **Run the admin test suite with a real `API_KEY`** to exercise the eight skipped auth/rate-limit tests before the next release.
3. **Add CI** that runs `npm run build`, `npx oxlint`, and `npm test` on every PR.
4. **Document `EXPERIENCE_FIRST` as paid-tier only** or align its `UPLOAD_INTERVAL_BATCHES`/`CONTINUOUS_INTERVAL_MS` with the `COST_FIRST` throttling values.
5. **Remove `http://localhost:5173` from `ALLOWED_ORIGINS` in production `wrangler.toml`** (keep it only in a local `.dev.vars` override).
6. **Consider clearing the pending delta only on successful upload**, or adding a transient-retry mechanism, to avoid losing training data on network errors.
7. **Consider moving `synthetic_games` from KV to D1** so `/api/merge-weights` uses one KV read + one KV write instead of two of each.

---

## 7. Verification Commands

```bash
# Web build
cd /Users/jeremy/battleships-rl/web
npm install
npm run build

# Lint
cd /Users/jeremy/battleships-rl/web
npx oxlint src/
cd /Users/jeremy/battleships-rl
./web/node_modules/.bin/oxlint worker admin

# Tests
cd /Users/jeremy/battleships-rl/admin
npm test

# Deploy
cd /Users/jeremy/battleships-rl/worker
npx wrangler deploy
cd /Users/jeremy/battleships-rl/web
npm run deploy
```

All of the above completed successfully during this review except the `admin/.env` API key, which caused the eight auth tests to be skipped.
