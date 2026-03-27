#!/usr/bin/env python3
"""
Make a move in Tic-Tac-Toe.

Usage:
    python move.py <position> --name <your_name>

Position is 1-9:
    1 | 2 | 3
    4 | 5 | 6
    7 | 8 | 9

Examples:
    python move.py 5 --name Alice
    python move.py 1 --name "Claude AI"
"""
import sys
import os
import argparse
sys.path.insert(0, os.path.dirname(__file__))

from game import GameError, apply_move, format_board, load_state, save_state

def main():
    parser = argparse.ArgumentParser(description="Make a move in Tic-Tac-Toe")
    parser.add_argument("position", type=int, help="Position 1-9")
    parser.add_argument("--name", "-n", required=True, help="Your player name")
    args = parser.parse_args()

    pos = args.position
    name = args.name

    state = load_state()
    try:
        symbol = apply_move(state, name, pos)
    except GameError as exc:
        print(f"Error: {exc}")
        if state is not None and state.get("board"):
            print(format_board(state["board"]))
        sys.exit(1)

    save_state(state)

    print(f"✓ {name} ({symbol}) played position {pos}")
    print(format_board(state["board"]))
    print(f"  {state['message']}")

    if state["status"] == "done":
        print()
        print("Game over! Run 'python new_game.py' to play again.")

if __name__ == "__main__":
    main()
