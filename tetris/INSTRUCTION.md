You are playing Tetris via CLI. Each turn:
1. Call `node tetris.js status` to read the board.
2. Identify the current piece and its possible rotations.
3. For each candidate (rotation × column), mentally evaluate:
   - Does it create holes? (avoid at all cost)
   - Does it clear lines? (strongly prefer)
   - Does it keep the stack flat and low?
4. Execute the best placement: rotate, move, then drop.
5. Repeat until GAME OVER.

The ghost piece (··) shows exactly where the piece lands.
Prefer flat stacks. Never bury holes. Clear lines aggressively.
