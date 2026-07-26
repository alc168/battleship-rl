# Pre-training the Battleship AI

This document describes the offline, self-play DQN training that runs on the
MacBook Air M4 and the Ubuntu laptop, and how the resulting `ai_policy.json`
feeds the React game.

## Why we pre-train locally

The original workflow used Google Colab for DQN self-play. Colab sessions
expire and disconnect, so the training was rewritten to run on local hardware:

- **MacBook Air M4** — main trainer, using PyTorch Metal Performance Shaders
  (`mps`) for fast CNN/DQN updates and hourly GitHub pushes.
- **Ubuntu laptop** — secondary trainer, CPU-only, no GitHub pushes, used to
generate extra self-play experience that can be merged later.

Running locally gives us full control over the starting point, lets us resume
from any checkpoint, and keeps the model/policy files on machines we own.

## What is being trained

Two artefacts are produced by the training loop:

1. **`dqn_battleship.pt`** — the internal PyTorch DQN weights. This is the
   learning model that selects shots during self-play.
2. **`ai_policy.json`** — a pre-computed lookup table of board states to
   recommended shots. This is the artefact that the React game actually uses.

The heavy neural-network work is done once, offline. The web game only needs
the lightweight `ai_policy.json` file, so it can run in a browser without
loading PyTorch.

## Methodology

The trainer (`battleship_colab_runner.py`, originally Colab-shaped, now
local-adapted) loops over blocks of self-play games:

1. **Self-play episode** — the DQN model plays a full game of Battleship
   against random ship placements, using epsilon-greedy exploration.
2. **Replay & optimisation** — each move is stored in a replay buffer and the
   DQN is updated with sampled batches.
3. **Target network sync** — the target Q-network is periodically copied from
   the policy network.
4. **Teacher evaluation** — after a block, the current model is asked to score
   every legal shot for the board states that appeared during that block. The
   top shots for each state are written into `ai_policy.json`.
5. **Persistence** — the model, replay buffer and a checkpoint file are saved
   to disk, and `ai_policy.json` is pushed to GitHub (Mac only).

The Mac uses `mps`, the Ubuntu container uses `cpu`; otherwise the pipeline is
identical.

## Resuming and improving

The runner is resumable. On start it looks for:

- `dqn_battleship.pt` — loads the DQN weights.
- `checkpoint.json` — loads `steps_done`, `total_episodes` and the adaptive
  `games_per_block`.
- `ai_policy.json` — loads the existing policy map so new states are merged
  in rather than starting from scratch.

This means training can stop at any time (power loss, network issue, manual
stop) and pick up exactly where it left off. More games lead to:

- more diverse states in the replay buffer,
- better Q-value estimates,
- better Teacher recommendations,
- a richer `ai_policy.json` with more states and more accurate top shots.

The Mac is currently set to run until stopped (`TARGET_GAMES=999999`). The
Ubuntu trainer runs in 1-hour blocks (`MAX_BLOCK_SECONDS=3600`) so it can be
checked and restarted cleanly.

## From `ai_policy.json` to a game move

`ai_policy.json` is a dictionary whose keys are 100-character strings, one
character per board cell:

| Char | Meaning                    |
|------|----------------------------|
| `0`  | Unknown (not attacked)     |
| `1`  | Miss                       |
| `2`  | Hit (unsunk ship)          |
| `3`  | Sunk ship cell             |

Each key represents the board as seen by the computer player. The value is an
array of recommended shots, typically `[[row, col, score, wins, samples], ...]`
sorted from best to worst.

When the computer needs a move, the React code:

1. Builds a 100-character key from the current state of the human board
   (`getBoardKey`).
2. Looks for an exact match in `ai_policy.json`.
3. If no exact match, falls back to `empty_board` when few cells are known.
4. Otherwise searches for the closest known key within a small Hamming distance.
5. Picks the first recommended `(row, col)` that has not already been fired on.

Because the lookup is a plain JSON object, the browser can choose shots in a
few milliseconds even on a phone, with no PyTorch or model inference running
in the page.

## Relationship to the React program

`ai_policy.json` is pushed to `https://github.com/alc168/battleships-rl` (Mac
trainer, hourly). The React application uses this file as its `weightMap` —
either loaded directly from the raw GitHub URL or exposed through the API
layer that serves `/api/weight-map`. Either way, the in-browser `getAiMove`
function consumes the same 100-character keys and recommended shot lists.

So the cycle is:

```
Local DQN training (Mac / Ubuntu)
        |
        v
  ai_policy.json  ----pushed-to---->  GitHub main branch
        |
        v
  React app loads weightMap
        |
        v
  getAiMove(boardKey) -> best shot
```

The `dqn_battleship.pt` file is not used by the React game directly; it is the
internal learning model that produces the `ai_policy.json` lookup table.
