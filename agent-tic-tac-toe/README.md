# Tic-Tac-Toe: Human and Agent

Terminal Tic-Tac-Toe with a shared JSON state file. Human and agent use the same basic commands:

- `python new_game.py`
- `python join.py <name> [X|O]`
- `python move.py <1-9> --name "<name>"`
- `python watch.py`

The extra synchronization command is:

- `python wait_for_turn.py --name "<name>"`

`wait_for_turn.py` blocks until it is that player's turn, then prints the updated board and status. If the game ends while waiting, it prints the final board and exits with code `1`.

## How it works

The game state lives in `game_state.json`. There is no server and no background process.

Each player joins with a name and symbol, then plays by calling `move.py`. A human can watch the board live with `watch.py`.

The agent uses `wait_for_turn.py` as its synchronization primitive:

1. `wait_for_turn.py` blocks until the human has moved or the game ends.
2. When it returns, it prints the latest board, the last move, and whose turn it is.
3. The agent chooses a move and calls `move.py`.
4. The agent calls `wait_for_turn.py` again.

## Board positions

```text
 1 | 2 | 3
 ---------
 4 | 5 | 6
 ---------
 7 | 8 | 9
```

## Human flow

```bash
python new_game.py
python watch.py
python join.py Alice X
python move.py 5 --name "Alice"
```

You can also use `python wait_for_turn.py --name "Alice"` if you want a blocking turn prompt instead of watching manually.

## Agent flow

```bash
python join.py "Agent" O
python wait_for_turn.py --name "Agent"
python move.py <1-9> --name "Agent"
python wait_for_turn.py --name "Agent"
```

The intended loop is:

1. Join once.
2. Run `wait_for_turn.py`.
3. Read the board from its output.
4. Choose a move.
5. Run `move.py`.
6. Go back to `wait_for_turn.py`.

`status.py --json` is still available, but the agent no longer needs it just to see the latest board after the human moves.
