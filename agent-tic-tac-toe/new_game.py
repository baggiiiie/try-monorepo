#!/usr/bin/env python3
"""Reset and start a new game."""
import sys
import os
sys.path.insert(0, os.path.dirname(__file__))

from game import init_game, STATE_FILE

def main():
    if STATE_FILE.exists():
        STATE_FILE.unlink()
    state = init_game()
    print("✓ New game started!")
    print()
    print("Both players should now join:")
    print("  python join.py <name>      # join with auto-assigned symbol")
    print("  python join.py <name> X    # join as X")
    print("  python join.py <name> O    # join as O")
    print()
    print("Then make moves with:")
    print("  python move.py <1-9> --name <your_name>")
    print()
    print("Watch the board live in another terminal:")
    print("  python watch.py")

if __name__ == "__main__":
    main()
