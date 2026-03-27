# Tic-Tac-Toe: Human and Agent

Terminal Tic-Tac-Toe with a shared JSON state file. It uses Node's built-in TypeScript execution (`node *.ts`, Node 23.6+). Human and agent use the same basic commands:

- `node new_game.ts`
- `node join.ts <name> [X|O]`
- `node move.ts <1-9> --name "<name>"`
- `node watch.ts`

The extra synchronization command is:

- `node wait_for_turn.ts --name "<name>"`

`wait_for_turn.ts` blocks until it is that player's turn, then prints the updated board and status. If the game ends while waiting, it prints the final board and exits with code `1`.

## How it works

The game state lives in `game_state.json`. There is no server and no background process.

Each player joins with a name and symbol, then plays by calling `move.ts`. A human can watch the board live with `watch.ts`.

The agent uses `wait_for_turn.ts` as its synchronization primitive:

1. `wait_for_turn.ts` blocks until the human has moved or the game ends.
2. When it returns, it prints the latest board, the last move, and whose turn it is.
3. The agent chooses a move and calls `move.ts`.
4. The agent calls `wait_for_turn.ts` again.

`status.ts --json` is still available, but the agent no longer needs it just to see the latest board after the human moves.

## Pi integration

When playing inside pi, the project-local extension at `.pi/extensions/tic-tac-toe.ts` opens a per-agent local socket in `.pi/ttt-streams/` and forwards pi's thinking output when the active model/provider exposes it.

`watch.ts` scans that directory automatically, so when pi is the coding agent you can run either:

```bash
node watch.ts
# or
bun watch.ts
```

and see:

- the board from `game_state.json`
- live streamed pi reasoning while each connected agent is thinking
- the latest completed reasoning associated with the most recent move from each agent

The extension auto-detects the player name from successful `join.ts` / `move.ts` commands. If needed, you can inspect or override it inside pi with:

```text
/ttt-player
/ttt-player Agent-X X
/ttt-player clear
```

If pi is not running in this repo, `watch.ts` still works and simply shows that no pi thinking streams are active. After changing the extension, run `/reload` inside pi.

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
node new_game.ts
node watch.ts
node join.ts Alice X
node move.ts 5 --name "Alice"
```

You can also use `node wait_for_turn.ts --name "Alice"` if you want a blocking turn prompt instead of watching manually.

## Agent flow

```bash
node join.ts "Agent" O
node wait_for_turn.ts --name "Agent"
node move.ts <1-9> --name "Agent"
node wait_for_turn.ts --name "Agent"
```

The intended loop is:

1. Join once.
2. Run `wait_for_turn.ts`.
3. Read the board from its output.
4. Choose a move.
5. Run `move.ts`.
6. Go back to `wait_for_turn.ts`.

`status.ts --json` is still available, but the agent no longer needs it just to see the latest board after the human moves.
