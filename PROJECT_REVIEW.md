# Battleships RL — Comprehensive Architecture Review and Future Roadmap

**Project:** `battleship-rl` (deployed at `https://alc168.github.io/battleships-rl/`)  
**Version reviewed:** 1.01a  
**Date:** 2026-07-26  
**Audience:** A technically literate reader with no prior knowledge of the project.

---

## 1. Executive Summary

This project is a browser-based Battleship game in which a human player competes against a computer opponent that learns from every game. The computer improves in two ways: it remembers which human ship layouts win, and it runs thousands of simulated practice games in the background to learn which squares are most likely to lead to victory. All of this learning is stored in the cloud, so the computer gets better across every player and every session.

The system is deliberately built around a "hobby project" budget: it uses free tiers, runs logic in the player's browser where possible, and offloads heavy work to a background Web Worker. The final architecture is a hybrid edge system: a static React frontend on GitHub Pages, a Cloudflare Worker API, Cloudflare D1 for ship-layout history, and Cloudflare KV for the learned shooting policy. It is fast, cheap, and self-improving — but it also makes some well-understood trade-offs around data sparsity, mobile polish, and long-term scalability.

This report explains how the project evolved, evaluates the architecture against modern software engineering best practice, and recommends the most valuable next steps, ordered by the project's stated priorities:

1. Best user gameplay experience  
2. Low cost  
3. Elegant and efficient  
4. Self-learning

---

## 2. What the Project Does

Battleship is a two-player strategy game. Each player hides five ships on a 10×10 grid and takes turns firing at the opponent's grid. In this version, the human places ships and fires at the computer; the computer fires back automatically.

The "RL" in the name stands for *reinforcement learning*. The computer does not follow a fixed script. Instead, it keeps a table of win rates for every board situation it has seen. After many games, it learns that certain squares are statistically better shots in certain situations. It also remembers human ship placements that led to human victories and copies those layouts for itself.

Key files:

- `web/src/App.jsx` — the main React application and game loop.
- `web/src/utils.js` — grid logic, AI lookup, and training helpers.
- `web/src/training.worker.js` — the background Web Worker that self-plays games.
- `web/src/training.config.js` — training hyperparameters.
- `worker/index.js` — the Cloudflare Worker API.
- `worker/wrangler.toml` — Cloudflare binding configuration.
- `admin/run-tests.mjs` — an admin test harness.

---

## 3. How the Architecture Evolved

### Phase 1: Static prototype

The earliest version was a pure React app hosted on GitHub Pages. It loaded a static `ai_policy.json` file and stored placement memory in `localStorage`. This was fast and free, but the AI could not learn from other players and was limited by browser storage.

### Phase 2: Cloudflare edge backend

A Cloudflare Worker was added with two storage systems:

- **Cloudflare D1** (a serverless SQLite database) for human ship layouts.
- **Cloudflare KV** (a global key-value store) for the learned shooting policy, called the *weight map*.

The Worker exposed endpoints such as `/api/weight-map`, `/api/top-layouts`, `/api/record`, and `/api/merge-weights`. API key authentication, CORS restriction, input validation, and rate limiting were added later.

### Phase 3: In-browser training

A Web Worker was introduced so the browser could simulate hundreds of self-play games without freezing the user interface. The worker produces a *delta* (a small update to the weight map), the main thread merges it locally, and then it is uploaded to Cloudflare KV. Training began immediately on page load and later ran continuously in 250-game batches.

### Phase 4: Smarter AI

The AI originally required an exact 100-character board-state match. This caused frequent fallback to random shots because the number of possible states is enormous. Two improvements were added:

1. **Nearest-state lookup**: if no exact match exists, the AI finds the closest known state within a small Hamming distance.
2. **Empty-board policy**: on nearly empty boards, the AI uses a dedicated opening policy.

Symmetry augmentation was also added to the training worker, multiplying effective training data by eight by rotating and reflecting each board state.

### Phase 5: UI, personality, and mobile

A tactical console was built showing the computer's "thinking," a humour dial, combat statistics, and a firing probability heatmap. Later, sound effects, mobile responsiveness, and a modern SVG-based sound toggle were added. The final mobile layout places enemy waters at the top, friendly waters below, and the full tactical console underneath friendly waters.

---

## 4. Current Architecture

### 4.1 Components and technologies

| Layer | Technology | Role |
|---|---|---|
| Frontend | React 19 + Vite 8 | UI, game loop, and move logic. |
| Styling | Tailwind CSS 3.4 | Utility-first responsive styling. |
| Static hosting | GitHub Pages | Free hosting for the compiled `dist/` folder. |
| Background training | Web Worker (`training.worker.js`) | Simulates 250-game self-play batches. |
| API | Cloudflare Worker (`worker/index.js`) | Edge API with D1 and KV bindings. |
| Layout history | Cloudflare D1 | SQLite table of human ship layouts. |
| Shooting policy | Cloudflare KV | Global JSON weight map. |
| Admin tests | Custom Node harness | 36 tests covering utils, training, API, and security. |

### 4.2 Data flow

1. The player opens the app. The browser fetches the current weight map from KV and top human layouts from D1.
2. The player places ships and plays turns. All computer move decisions are made in-memory in the browser for speed.
3. A Web Worker continuously plays self-play games, producing a delta of state-action win rates.
4. The delta is uploaded to `/api/merge-weights`, and Cloudflare KV is updated for the next player.
5. When a real game ends, the human's layout is sent to `/api/record` and D1 is updated.

### 4.3 Learning algorithm

The learning is a lightweight form of **Monte Carlo reinforcement learning**:

- For every shot the AI fires, it stores the board state and the coordinate.
- If the AI wins that game, the pair is credited with a win.
- Win rate is `wins / samples`.
- For each state, only the top actions by win rate are kept in KV.

For ship placement, the computer copies top-rated human layouts from D1. Layouts with higher human win rates are more likely to be used.

### 4.4 Training configuration

`web/src/training.config.js` defines two presets:

- **COST_FIRST**: 250 games per batch, 20 actions per state, minimal samples, longer intervals. Keeps Cloudflare usage near free tiers.
- **EXPERIENCE_FIRST**: Smaller intervals, more states, and mobile training enabled. Uses more KV writes for faster feedback.

The active preset is chosen by `VITE_TRAINING_MODE` at build time.

---

## 5. Best-Practice Review

### 5.1 What the project does well

- **Speed of moves**: All computer decisions are made client-side after an initial download, so latency is effectively zero for gameplay.
- **Cost discipline**: GitHub Pages, Cloudflare free tiers, and batch uploads keep running costs at or near zero.
- **Security basics**: API keys are held in Cloudflare Worker secrets, not the browser bundle. D1 queries are parameterized. POST endpoints are authenticated, rate-limited, and validated.
- **Non-blocking training**: Web Workers prevent UI freezes during heavy simulation.
- **Continuous learning**: The AI trains while the player is playing and merges results globally.
- **Test coverage**: The admin harness runs 36 tests across utilities, training, API behaviour, and security.
- **Responsive UI**: The app adapts from desktop to mobile, with a dedicated mobile-first layout.
- **Fallback strategy**: Nearest-state lookup and the empty-board policy reduce random fallbacks significantly.
- **Symmetry augmentation**: Training data is multiplied by eight without extra CPU cost per game.

### 5.2 Areas not covered or needing improvement

#### Code organisation

`web/src/App.jsx` is a very large monolith. It mixes UI rendering, game state management, audio playback, mobile detection, training orchestration, and animation. For long-term maintenance, this should be split into:

- Dedicated React components (grid, console, status bar, header).
- Custom hooks for audio, training, and mobile detection.
- A separate game-state reducer or store.

This would make the code easier to test, reason about, and extend.

#### Type safety

The project uses JavaScript with some `@types/react` dev dependencies, but there is no TypeScript. As the AI data structures and API contracts grow more complex, TypeScript would catch errors at build time and make refactoring safer.

#### Automated testing

The 36 admin tests are valuable, but they are not integrated with the frontend build. There are no unit tests for `App.jsx`, no end-to-end tests for the actual game flow, and no visual regression tests for the mobile UI. Adding Vitest for `utils.js` and Playwright or Cypress for the UI would close this gap.

#### Accessibility

- Many controls rely on colour alone (for example, the heatmap communicates probability through colour and small numbers).
- Some status text uses emojis without text alternatives.
- Keyboard navigation is not fully managed; placement and firing are mouse/touch only.
- Focus management when the console opens and closes is not explicit.

#### Mobile UX

Recent improvements are good, but further work is possible:

- The console toggle is at the top of the screen, outside the natural thumb zone. A sticky bottom bar or a floating action button would be more ergonomic.
- Grid cells are small (`w-6 h-6`, 24 px). Modern mobile-first guidance recommends 48×48 px touch targets.
- The console could open as a bottom sheet or drawer rather than pushing content down.
- There is no Progressive Web App manifest, so the game cannot be installed or played offline.

#### Performance and scalability

- The entire weight map is loaded into memory at startup. As it grows, load time and memory use will increase. There is no lazy loading, sharding, or incremental update strategy.
- KV is eventually consistent and has a 25 MiB value-size limit. A very large weight map could exceed this and require sharding across multiple keys or a move to R2.
- D1 is excellent for relational reads but has write throughput limits. High traffic could saturate the free-tier write capacity.
- Audio files are MP3; Ogg/Opus would be smaller for the same quality.

#### Security hardening

- `wrangler.toml` contains D1 and KV resource IDs. These are not secrets, but they are public in a public repository.
- The API key is optional until configured (`if (!env.API_KEY) return true`). A misconfigured Worker could accept anonymous writes.
- Rate limiting uses `X-Forwarded-For` if `CF-Connecting-IP` is missing. Outside Cloudflare's network, `X-Forwarded-For` can be spoofed.
- There is no abuse protection against large or malformed weight deltas beyond size limits.

#### Machine learning limitations

- The AI still uses exact-key tabular lookup. A single changed cell creates a new 100-character key, so most states are unseen. Nearest-state lookup helps, but it is a patch, not a solution.
- The AI does not yet learn from real human games. It learns from self-play against random placements, which may not match real human play.
- `MIN_SAMPLES` filtering discards rare but potentially useful actions. Confidence-bounded ranking (for example, Wilson score lower bound) would be better.
- There is no exploration/exploitation schedule; the AI always greedily picks the highest win-rate action.

#### DevOps and observability

- Deployment is manual: `npm run deploy` from a local machine.
- There is no CI/CD pipeline, staging environment, or automated preview deployments.
- There is no runtime error tracking, analytics, or monitoring.
- `gh-pages` deployments are not atomic; a failed upload could leave the site in a mixed state.

---

## 6. Reflection on Architecture and Technology Choices

### 6.1 Why these choices were made

**React + Vite + Tailwind**  
React is a standard, well-documented UI library. Vite provides fast builds and a modern development experience. Tailwind makes responsive styling rapid and keeps the CSS footprint small. For a solo developer or small team, this is a pragmatic, low-friction stack.

**GitHub Pages**  
GitHub Pages is free, works directly from the repository, and requires no extra account. The trade-off is that deployments are manual and there is no branch-based preview environment. Cloudflare Pages or Vercel would offer atomic deploys and preview URLs.

**Cloudflare Worker, D1, and KV**  
Cloudflare's edge network is fast and cheap. D1 gives full SQL semantics for layout history. KV gives globally cached reads for the weight map, which is ideal because it is read many times and written infrequently. The Worker holds the API key, keeping credentials out of the browser. This is a strong fit for a low-cost, read-heavy learning application.

**Web Worker for training**  
Running training in the main thread would freeze the UI. A Web Worker keeps the game responsive while simulation happens in the background. This is the correct approach for browser-based heavy computation.

**Tabular Monte Carlo instead of a neural network**  
A neural network can generalise across similar states, but it is heavier to run, harder to train in a browser, and more complex to deploy. A tabular policy is simpler, fully inspectable, and fast. The project added nearest-state lookup and symmetry augmentation to compensate for the tabular approach's main weakness: state-space sparsity.

### 6.2 Trade-offs accepted

- **Accuracy vs. cost**: The AI is not as strong as a deep neural network, but it is free to run and easy to understand.
- **Freshness vs. consistency**: KV is eventually consistent, so a weight update may take up to a minute to propagate globally. This is acceptable for a hobby learning loop.
- **Scope vs. maintainability**: A single large `App.jsx` file allowed rapid iteration, but it now hinders testing and extension.
- **Mobile vs. desktop**: The desktop two-column console is powerful but does not translate cleanly to a phone. Recent work has improved this, but a dedicated mobile-first component design is still needed.

---

## 7. Alternative Architecture Options to Consider Now

### 7.1 Hosting and deployment

- **Cloudflare Pages instead of GitHub Pages**  
  Pages offers atomic deploys, preview branches, and better integration with the Cloudflare Worker. It would still be free for this scale.
- **Vercel or Netlify**  
  These provide excellent developer experience and preview environments, but they would introduce a second vendor alongside Cloudflare.

### 7.2 Storage

- **Cloudflare Durable Objects**  
  For strongly consistent counters, leaderboards, or a central training queue, Durable Objects would be more appropriate than KV. They are more expensive but guarantee consistency.
- **Cloudflare R2**  
  If the weight map grows beyond KV's 25 MiB limit, R2 can store large JSON snapshots cheaply. The app could fetch incremental updates rather than the whole map.
- **Turso or PlanetScale**  
  If leaving the Cloudflare ecosystem, Turso offers edge SQLite with strong consistency, and PlanetScale offers MySQL-based scaling. Both add cost.

### 7.3 Frontend framework

- **Svelte or Solid**  
  These compile to smaller bundles than React and can improve performance on low-end mobile devices. The trade-off is a smaller ecosystem and migration effort.
- **TypeScript**  
  Not a framework change, but adding TypeScript would be the single biggest maintainability improvement for a small investment.

### 7.4 AI model

- **TensorFlow.js or ONNX Runtime**  
  A small convolutional neural network could replace the exact-key table. It would generalise to unseen states and remove the random-fallback problem. The trade-off is larger bundle size, longer training, and more complex deployment.
- **Function approximation with a compact model**  
  A small multi-layer perceptron trained offline on self-play data could be a middle ground: more generalisation than a table, but lighter than a full CNN.

### 7.5 Caching and offline

- **Service Worker with Workbox**  
  Caching the weight map, audio, and assets would allow offline play and faster repeat visits. A PWA manifest would let users install the game.

---

## 8. Enhancement Roadmap

The following ideas are ordered by the project's priorities.

### 8.1 Best user gameplay experience

1. **Online learning from real games**  
   Record the real board states and final outcomes of human games, then merge a small delta into the weight map. This directly addresses the mismatch between self-play training and live human opponents.

2. **Smarter ranking with confidence**  
   Replace raw win-rate sorting with a Wilson score or UCB (upper confidence bound) score. This keeps rare but promising actions available while penalising weak evidence.

3. **Tactical targeting improvements**  
   Add parity-based hunting (shooting only every other square early on), ship-size constraints, and heatmap-aware search. This makes the AI feel more human and reduces wasted shots.

4. **Difficulty levels**  
   Let the player choose how much the AI uses its learned policy versus random fire, giving beginners a fairer start.

5. **Mobile-first console redesign**  
   Convert the tactical console into a bottom-sheet or slide-up panel, increase touch targets to at least 48×48 px, and add a sticky bottom control bar for sound and console toggles.

### 8.2 Low cost

1. **Shard the weight map**  
   Split the KV value across multiple keys by board-state prefix, or store large snapshots in R2 and fetch incremental diffs. This prevents the 25 MiB limit from becoming a hard ceiling.

2. **Batch uploads more aggressively**  
   Increase `GAMES_PER_BATCH` and only upload after several batches, reducing KV write operations.

3. **Client-side caching**  
   Cache the weight map in `IndexedDB` and only request it if the server's ETag or version has changed. This reduces bandwidth and KV read costs.

4. **Audio optimisation**  
   Convert MP3s to Ogg/Opus for smaller file sizes without quality loss.

### 8.3 Elegant and efficient

1. **Refactor `App.jsx`**  
   Split it into components (`Header`, `Grid`, `StatusBar`, `Console`, `AudioProvider`) and hooks (`useGameState`, `useTraining`, `useMobile`, `useAudio`). This improves readability and testability.

2. **Adopt TypeScript**  
   Gradually add types to `utils.js`, the API layer, and React props. This catches errors and documents the data model.

3. **Add proper automated testing**  
   - Vitest for `utils.js` and the training worker.
   - Playwright for the full game flow on desktop and mobile.
   - Snapshot or visual tests for the console.

4. **PWA support**  
   Add a `manifest.json`, icons, and a service worker so the game can be installed and played offline.

5. **CI/CD**  
   Use GitHub Actions to run tests and deploy to Cloudflare Pages on every merge to `main`. Add a staging branch for preview builds.

### 8.4 Self-learning

1. **Learn from live games**  
   This is the highest-impact learning improvement. Send the actual move trace from human games to the Worker and merge it into the weight map.

2. **Neural network function approximator**  
   When the tabular approach can no longer scale, train a small network offline on self-play and real-game data, then run it in the browser for inference.

3. **Exploration schedule**  
   Start with more random exploration and gradually become greedier, so the AI discovers new states while still exploiting known good moves.

4. **Curriculum training**  
   Train the AI against increasingly strong opponents, not purely random placements, to produce more robust policies.

---

## 9. Conclusion

The Battleships RL project is a clever, well-executed demonstration of how to build a self-improving game on a near-zero budget. It makes sensible trade-offs: a tabular policy for simplicity, a Web Worker for responsiveness, and Cloudflare's edge services for cheap, global persistence. The result is a fast, playable, genuinely learning Battleship opponent that works in a browser.

The strongest next steps are:

1. **Learn from real human games** — this would immediately improve the AI's relevance to actual opponents.
2. **Refactor the frontend** — split `App.jsx` into components and add TypeScript and tests.
3. **Improve mobile UX** — larger touch targets, a bottom-sheet console, and PWA support.
4. **Plan for weight-map growth** — shard KV or move to R2 before the policy outgrows a single key.
5. **Add CI/CD and monitoring** — automate testing and deployment, and track errors in production.

If these are done in order, the project will remain cheap, elegant, and increasingly self-learning while giving players an even better gameplay experience.
