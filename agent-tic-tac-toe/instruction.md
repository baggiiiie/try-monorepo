# Tic-Tac-Toe: Agent Instructions

You are playing Tic-Tac-Toe against a human through the CLI scripts in this directory.

Use your own reasoning to choose moves. Do not use a repo-side solver or autoplay script.
After you start, stay in the loop yourself until the game ends.

## Board layout

```text
 1 | 2 | 3
 ---------
 4 | 5 | 6
 ---------
 7 | 8 | 9
```

## Your loop

1. Join the game:

```bash
python join.py "Agent" O
```

If O is taken, join as X instead:

```bash
python join.py "Agent" X
```

2. Wait for your turn:

```bash
python wait_for_turn.py --name "Agent"
```

This command blocks until you can act. When it returns, it prints the latest board, last move, and turn status.

- Exit code `0`: it is your turn now
- Exit code `1`: the game is over
- Exit code `2`: setup error

3. Read the board from `wait_for_turn.py` output and decide your move.

4. Make your move:

```bash
python move.py <position> --name "Agent"
```

5. Go back to step 2 and repeat until `wait_for_turn.py` exits with code `1`.

## Rules

- Always wait before moving.
- Never make two moves in a row.
- If `move.py` fails, read the error and try again.
- When the game ends, print a short friendly message to the human.
