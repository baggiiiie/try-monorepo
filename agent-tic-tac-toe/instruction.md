# Tic-Tac-Toe: Instructions for Claude Code

You are playing Tic-Tac-Toe against a human opponent. The game is controlled entirely via CLI scripts in this directory. Follow these instructions exactly.

Default behavior: use unattended mode. Do not ask the human for further prompts once you start playing.

## Board layout

Positions are numbered 1–9:

```
 1 | 2 | 3
-----------
 4 | 5 | 6
-----------
 7 | 8 | 9
```

## Your loop

**Preferred unattended mode**

Run exactly one command:
```bash
python agent_play.py "Claude"
```
That command will:
- join the game for you, requesting `O` by default
- it blocks until it is your turn
- it chooses and plays the best move automatically
- it blocks again after your move
- it exits only when the game is over

If you specifically need to request `X`, run:
```bash
python agent_play.py "Claude" X
```

---

## Manual loop

Use this only if you explicitly want to reason about every move yourself instead of using unattended mode.

**Step 1 — Join the game**
```bash
python join.py "Claude" O
```
If O is taken, join as X instead:
```bash
python join.py "Claude" X
```

**Step 2 — Wait for your turn**
```bash
python wait_for_turn.py --name "Claude"
```
This command blocks until it is your turn. Do not proceed until it exits.
- Exit code `0` = it's your turn, make a move
- Exit code `1` = game is over, read the output to see the result

**Step 3 — Read the board**
```bash
python status.py
```

**Step 4 — Make your move**
```bash
python move.py <position> --name "Claude"
```

**Step 5 — Go back to Step 2** and repeat until `wait_for_turn.py` exits with code `1`.

---

## Important rules

- Use your knowledge of the game to make the best move, the goal is to win.
- Prefer `--auto-play --quiet` when the goal is to run unattended until the game ends.
- Always run `wait_for_turn.py` before each of your moves — never skip it
- Never make two moves in a row
- If a move fails (position taken, wrong turn), read the error and correct it
- When the game ends, print a short friendly message to the human
