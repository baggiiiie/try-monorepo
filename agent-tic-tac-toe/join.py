#!/usr/bin/env python3
"""
Join the Tic-Tac-Toe game.

Usage:
    python join.py <your_name> [X|O]

Examples:
    python join.py Alice        # auto-assign symbol
    python join.py Bob O        # request O
    python join.py "Agent"  # agent joins
"""
import sys
import os
sys.path.insert(0, os.path.dirname(__file__))

from game import format_state_snapshot, init_game, load_state, save_state

def main():
    if len(sys.argv) < 2:
        print("Usage: python join.py <your_name> [X|O]")
        print("Example: python join.py Alice")
        print("Example: python join.py Bob O")
        sys.exit(1)

    name = sys.argv[1]
    preferred = sys.argv[2].upper() if len(sys.argv) > 2 else None

    if preferred and preferred not in ("X", "O"):
        print("Symbol must be X or O")
        sys.exit(1)

    state = load_state()
    if state is None:
        print("No game found. Starting a new game...")
        state = init_game()

    if state["status"] == "done":
        print("Game is over. Start a new game with: python new_game.py")
        sys.exit(1)

    players = state["players"]

    # Already joined?
    for sym, n in players.items():
        if n == name:
            print(f"You ({name}) are already in the game as {sym}!")
            print(format_state_snapshot(state, viewer_name=name))
            sys.exit(0)

    if len(players) >= 2:
        print("Game is full! Two players already joined.")
        for sym, n in players.items():
            print(f"  {sym}: {n}")
        sys.exit(1)

    # Assign symbol
    taken = set(players.keys())
    if preferred:
        if preferred in taken:
            print(f"{preferred} is already taken by {players[preferred]}.")
            other = "O" if preferred == "X" else "X"
            print(f"Assigning you {other} instead.")
            symbol = other
        else:
            symbol = preferred
    else:
        # Auto-assign: X first, then O
        symbol = "X" if "X" not in taken else "O"

    players[symbol] = name
    state["players"] = players

    if len(players) == 2:
        state["status"] = "playing"
        names = list(players.values())
        state["message"] = f"Game on! {players['X']} (X) vs {players['O']} (O). X goes first."
    else:
        state["message"] = f"{name} joined as {symbol}. Waiting for opponent..."

    save_state(state)

    print(f"✓ Joined as {symbol} ({name})")
    print(format_state_snapshot(state, viewer_name=name))
    print()
    print(f'Move with: python move.py <1-9> --name "{name}"')
    print(f'Wait with: python wait_for_turn.py --name "{name}"')

if __name__ == "__main__":
    main()
