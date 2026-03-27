# Tic-Tac-Toe: Human vs Agent

A terminal-based Tic-Tac-Toe game designed for a **human** and a coding agent to play together.
State is shared via a JSON file (`game_state.json`) — no server needed.

## Files

| File | Purpose |
|------|---------|
| `new_game.py` | Reset / start a fresh game |
| `join.py` | Join as a player |
| `move.py` | Make a move (position 1–9) |
| `agent_play.py` | Join and auto-play until the game ends |
| `wait_for_turn.py` | **Blocks until it's your turn** and can now auto-play until game over |
| `watch.py` | **Live TUI** — run this in your terminal |
| `status.py` | One-shot board snapshot |
| `game.py` | Shared logic (not run directly) |

## Board positions

```
 1 | 2 | 3
 ---------
 4 | 5 | 6
 ---------
 7 | 8 | 9
```

---

## How to play

### Step 1 — Start a new game
```bash
python new_game.py
```

### Step 2 — Open the live board (human terminal)
```bash
python watch.py
```
Keep this open. It refreshes every 0.5 seconds.

### Step 3 — Both players join

**Human:**
```bash
python join.py Alice
```

**Agent** (in a second terminal / Agent session):
```bash
python join.py "Agent" O
```

### Step 4 — Take turns making moves

```bash
# Human
python move.py 5 --name Alice

# Agent
python move.py 1 --name "Agent"
```

### Step 4b — Fully autonomous agent mode

If you want the non-human side to run unattended after a single command, start it like this:

```bash
python agent_play.py "Agent"
```

That process will:
- join the game automatically, requesting `O` first
- block until it is the agent's turn
- choose the best available move locally
- play it immediately
- block again
- repeat until the game ends

### Step 5 — Play again
```bash
python new_game.py
```

---

## Prompt for Agent

Paste this into a Agent session to have it play against you:

```
Let's play Tic-Tac-Toe! The game lives in the `tictactoe/` directory.

Rules:
- Board positions: 1=top-left, 5=center, 9=bottom-right
- One-shot autoplay: python agent_play.py "Agent"
- Join:          python join.py "Agent" O
- Wait for turn: python wait_for_turn.py --name "Agent"   ← blocks until it's your turn, exit 0 = your turn, exit 1 = game over
- Autonomous mode: python wait_for_turn.py --name "Agent" --auto-play --quiet
- Check board:   python status.py
- Move:          python move.py <1-9> --name "Agent"

Manual loop:
1. Join the game
2. If you're O: run wait_for_turn.py first (human goes first as X)
3. Read the board with status.py
4. Make your best move with move.py
5. Run wait_for_turn.py again — it will block until the human moves
6. Repeat from 3 until wait_for_turn.py exits with code 1 (game over)

Unattended loop:
1. Run `python agent_play.py "Agent"`
2. Do not wait for more human prompts; that single command will keep playing until the game ends

Try to play well — block my wins and take winning moves when you see them!
```

---

## Notes

- The game state lives in `game_state.json` — delete it or run `new_game.py` to reset
- Both players must join before moves are accepted
- `watch.py` shows a live TUI with colored X/O, turn indicator, and move history
- `status.py` is a quick one-shot snapshot (good for Agent to check state)
- `agent_play.py` is the simplest entrypoint for coding agents told to "read instruction.md and play"
- `wait_for_turn.py --auto-play` uses a local minimax player, so unattended mode no longer depends on follow-up prompts
