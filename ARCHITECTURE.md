# Battleship RL — Architecture Options & Recommendation

## 1. Executive Summary

This paper evaluates five architecture patterns for the `battleship-rl` React application. The optimisation targets are, in order:

1. **Player experience** — every computer move must feel instant.
2. **Background training** — the browser must be able to run 1,000 self-play games and improve a shared model.
3. **Cost** — hobby-project budget; prefer free tiers and scale gracefully.

The recommended approach is **Pattern E: Hybrid Edge with In-Browser Training**. It keeps all move decisions in the client after an initial load, offloads training to a Web Worker, and persists global learning in Cloudflare D1 and KV via a Worker. This delivers the fastest player experience at the lowest cost.

---

## 2. Requirements & Constraints

| Requirement | Target |
|---|---|
| Move latency | < 50 ms per computer shot |
| Page load | < 2 s on a 3G connection |
| Background training | 1,000 self-play games per session, no UI freeze |
| Shared memory | Learn from all players, not only the current browser |
| Storage cap | 10,000 human board layouts; weight map must be under Cloudflare KV limits |
| Cost | Prefer free; accept $0–$5/month for hobby scale |
| Security | No secrets in the browser bundle |

---

## 3. Review of the Current System

The current `battleship-rl` web app:

- Loads `ai_policy.json` once on start.
- Stores placement memory in `localStorage`.
- Computes the computer's shot with in-memory lookups and hunt heuristics.

**Strengths:** Fast, simple, free.
**Weaknesses:** Memory is device-specific, cannot learn across users, and is capped by `localStorage` (~5 MB). There is no server-side model improvement.

---

## 4. Architectural Patterns

### Pattern A: Pure Static + `localStorage` (status quo)

- The React app is a static Vite build on GitHub Pages.
- `ai_policy.json` is bundled or fetched at start.
- Placement memory is `localStorage` only.

**Pros:** Fastest possible moves; zero server cost.
**Cons:** No cross-user learning; loses data on cache clear; cannot support 10,000-board history across sessions.
**Best for:** Single-player demos with no persistence.

---

### Pattern B: Edge Persistence with Cloudflare D1 + KV

- Browser loads `weight_map` from KV and top layouts from D1 on start.
- After each game, the browser `POST`s the human layout and result to a Cloudflare Worker; the Worker writes to D1.
- Training is done on Colab or a server, which pushes a new `ai_policy.json`/`weight_map` to KV.

**Pros:** Persistent, shared, serverless.
**Cons:** Model improvement is not real-time; depends on Colab cycles.
**Best for:** A teacher model generated offline with occasional updates.

---

### Pattern C: Backend API + Postgres + Redis

- A small Node/Python backend with Postgres for layouts and Redis for the weight map.
- Browser calls the API for moves, training, and leaderboard data.

**Pros:** Full SQL power, easy analytics, large model storage.
**Cons:** Higher cost and operational overhead; every move may require a network round-trip, hurting latency.
**Best for:** Multiplayer tournaments or heavy analytics, not fast single-player.

---

### Pattern D: Periodic Batch Model from Colab

- Colab trains the PyTorch DQN and pushes `ai_policy.json` to the repo.
- Web app only fetches the updated JSON.
- No browser-side training.

**Pros:** Simplest deployment; proven DQN pipeline already exists.
**Cons:** No incremental learning from live human games; model grows stale between Colab runs.
**Best for:** A research-style pipeline with manual retraining.

---

### Pattern E: Hybrid Edge with In-Browser Training (recommended)

- React app loads `weight_map` (KV) and `top_layouts` (D1) once.
- All in-game decisions use in-memory JS objects; no network latency per move.
- A Web Worker runs 1,000 self-play games, produces a win-rate delta, and `POST`s the delta to a Cloudflare Worker.
- The Cloudflare Worker merges the delta into KV and updates D1 with the latest human layout.

**Pros:** Instant moves, real-time collective learning, scales on free tiers, no secrets in the browser.
**Cons:** KV value size requires monitoring; training consumes CPU/battery.
**Best for:** Fast, cheap, continuously improving single-player experience.

---

## 5. Comparison Matrix

| Criterion | A Static | B Edge Offline | C Backend | D Colab Batch | E Hybrid Edge |
|---|---|---|---|---|---|
| Move latency | Excellent | Good | Slowest | Excellent | Excellent |
| Cross-user learning | None | Limited | Yes | None | Yes |
| Real-time training | No | No | Possible | No | Yes |
| Background training | None | None | Server-side | Colab | Browser + Worker |
| Operational cost | Free | Free–$5 | $10–$50+ | Free | Free–$5 |
| Complexity | Low | Medium | High | Low | Medium |
| Security | No secrets | Token in Worker | Token in backend | No secrets | Token in Worker |
| Scalability | Device only | Free-tier limits | Good | Manual | Good |

---

## 6. Recommended Architecture: Pattern E (Hybrid Edge)

### 6.1 Components

| Component | Technology | Role |
|---|---|---|
| Frontend | React + Vite + Service Worker | UI, caching, move logic |
| Training Worker | Web Worker (`training.worker.js`) | Simulates 1,000 games and produces a delta |
| Edge Functions | Cloudflare Worker | API + secrets holder |
| Layouts DB | Cloudflare D1 | 10,000 human board layouts with win rates |
| Weights Store | Cloudflare KV | `weight_map` JSON |
| Optional Object Store | Cloudflare R2 | Snapshots if `weight_map` exceeds KV limits |
| Hosting | Cloudflare Pages | Static React build |

### 6.2 Data Model

**D1 table `layouts`**

```sql
CREATE TABLE IF NOT EXISTS layouts (
  layout_key TEXT PRIMARY KEY,   -- 100-char 0/1 ship-cell string
  wins INTEGER DEFAULT 0,
  games INTEGER DEFAULT 0,
  win_rate REAL DEFAULT 0.0,
  last_played INTEGER            -- unix timestamp
);
```

**KV key `weight_map`**

```json
{
  "0000000000...": [
    [0, 0, 0.62, 120],
    [0, 2, 0.61, 98],
    ...
  ],
  "0020000000...": [
    [5, 5, 0.74, 240],
    ...
  ]
}
```

Each recommendation stores `[row, col, win_rate, samples]` to allow merge-time recalculation.

### 6.3 API Surface

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/weight-map` | `GET` | Return the current `weight_map` from KV |
| `/api/top-layouts?n=3` | `GET` | Return the top 3 human layouts from D1 |
| `/api/record` | `POST` | Record a finished human game; update D1 |
| `/api/merge-weights` | `POST` | Merge a training delta into KV; rate-limited |
| `/api/stats` | `GET` | (Optional) Aggregate stats for the UI |

### 6.4 Optimum Configuration

#### Cloudflare

- **Workers:** Free plan for prototyping; upgrade to Paid ($5/month) if you exceed 100,000 requests/day.
- **D1:** One database, free tier. Eviction query runs after every insert to keep `layouts` at 10,000 rows.
- **KV:** One namespace. Use `weight_map` as the primary key. If the map approaches 25 MiB, shard by board-state prefix (`wm_000...`, `wm_001...`) or move snapshots to R2.
- **Pages:** Host the Vite `dist` output.

#### Browser

- **Initial load:** `fetch` `/api/weight-map` and `/api/top-layouts`; cache with a Service Worker.
- **In-memory structures:**
  - `Map<string, Array>` for `weight_map`.
  - `Array` of top layouts for placement selection.
- **Training trigger:** `requestIdleCallback` or after each real game completes.
- **Batch size:** 1,000 games per Web Worker run.
- **Upload cadence:** POST the delta once per training batch, not per simulated game.

#### Worker Merge Logic

1. Read existing `weight_map` from KV.
2. For each `(state_key, action)` in the delta, update `wins`/`samples` and recalculate `win_rate`.
3. Prune to the top 5 coordinates per state to keep size bounded.
4. Write the merged map back to KV.
5. For `record`, upsert `layouts` and evict the lowest `win_rate` rows over 10,000.

### 6.5 Data Flow

```
User opens app
  ├── Service Worker caches weight_map + top_layouts
  ├── React loads weight_map into memory
  └── Game starts
        ├── GET /api/top-layouts?n=3
        ├── Pick random top-3 layout for computer
        └── All moves use in-memory weight_map

User finishes game
  ├── POST /api/record (async, no UI block)
  └── requestIdleCallback -> spawn training.worker.js
        ├── Run 1,000 self-play games in memory
        ├── Build win-rate delta
        └── POST /api/merge-weights (async)
```

---

## 7. Cost Projection — 1 Month

Assumptions for a hobby project:

- 100 real games/day = 3,000 games/month.
- 1 training batch (1,000 games) per real player session ≈ 100/day.
- `weight_map` = ~5 MB; `layouts` = ~2 MB.

### Free-Tier Sufficiency

| Service | Free Limit | Projected Usage | Within Free? |
|---|---|---|---|
| Workers requests | 100,000/day | ~200/day | Yes |
| D1 rows read | 5,000,000/day | ~100/day | Yes |
| D1 rows written | 100,000/day | ~3,000/month | Yes |
| D1 storage | 5 GB | ~2 MB | Yes |
| KV reads | 100,000/day | ~100/day | Yes |
| KV writes | 1,000/day | ~100/day | Yes |
| KV storage | 1 GB | ~5 MB | Yes |

**Projected cost: $0/month.**

### If Usage Scales 10×

- 1,000 real games/day, 1,000 training batches/day.
- KV writes hit the daily free cap.
- D1 writes still within free limits.

**Recommendation:** Upgrade to **Workers Paid ($5/month)**. This removes the daily KV/Workers limits. Expected additional usage charges remain near $0 for D1/KV at this scale.

### If Usage Scales 100×

- 10,000 real games/day, 10,000 training batches/day.
- Beyond the free tier, approximate overage:
  - D1 writes: ~300,000 extra/month → ~$0.30
  - KV writes: ~300,000 extra/month → ~$1.50
  - KV reads: ~300,000 extra/month → ~$0.15
  - Workers Paid base: $5.00

**Approximate cost: $7–$10/month.**

---

## 8. Risks & Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| KV value > 25 MiB | Cannot store weight map | Shard by state prefix or switch to R2 for snapshots |
| D1 daily write cap hit | New games rejected | Batch writes; upgrade to Workers Paid |
| KV write spam | Cost/abuse | Rate-limit `merge-weights`; one write per session |
| Training freezes UI | Bad experience | Run 100% inside Web Worker |
| Stale weight map | Poor AI | Cache for one session; refresh on page load |
| Battery drain on mobile | User drop-off | Cap training to 250 games on mobile, 1,000 on desktop |
| First-load latency | Slow start | Service Worker + cache; show loading state if needed |

---

## 9. Implementation Roadmap

### Phase 1 — Foundation (1–2 days)
- Create Cloudflare Worker and D1/KV bindings.
- Add `/api/weight-map`, `/api/top-layouts`, and `/api/record` endpoints.
- Replace `localStorage` placement memory with API-backed flow.

### Phase 2 — Browser Training (2–3 days)
- Create `training.worker.js`.
- Implement 1,000-game self-play loop and delta generation.
- Add `/api/merge-weights` endpoint and merge logic.

### Phase 3 — Optimisation (1–2 days)
- Add Service Worker caching for offline speed.
- Implement KV sharding or R2 fallback if the map grows.
- Add device-aware training limits (mobile vs desktop).

### Phase 4 — Monitoring
- Add Cloudflare analytics for KV/D1 usage.
- Add Web Worker telemetry (games/sec, delta size).

---

## 10. Final Recommendation

**Use Pattern E: Hybrid Edge with In-Browser Training.**

It is the only pattern that simultaneously satisfies all three goals:

1. **Player experience:** All moves run from in-memory JS; no per-turn network.
2. **Background training:** A Web Worker runs 1,000 self-play games and uploads a delta.
3. **Cost:** Runs on Cloudflare's free tier for hobby scale and scales to a paid plan only when needed.

Start with the free tier. Monitor KV and D1 usage. Upgrade to the $5/month Workers Paid plan if you exceed daily free limits.
