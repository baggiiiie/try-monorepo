#!/usr/bin/env python3
"""Print the current game state."""
import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))

from game import format_state_snapshot, load_state


def main():
    parser = argparse.ArgumentParser(description="Show the current Tic-Tac-Toe state")
    parser.add_argument("--json", action="store_true", help="Print raw game state as JSON")
    parser.add_argument(
        "--name",
        "-n",
        help="Optional player name to show the snapshot from that player's perspective",
    )
    args = parser.parse_args()

    state = load_state()
    if state is None:
        print("No game found. Run: python new_game.py")
        sys.exit(1)

    if args.json:
        print(json.dumps(state, indent=2))
        return

    print(format_state_snapshot(state, viewer_name=args.name))


if __name__ == "__main__":
    main()
