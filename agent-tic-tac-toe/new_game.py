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
    print("Join with:")
    print("  python join.py <name>      # auto-assign X/O")
    print("  python join.py <name> X")
    print("  python join.py <name> O")
    print()
    print("Watch live:")
    print("  python watch.py")
    print()
    print("Play turns with:")
    print('  python wait_for_turn.py --name "<your_name>"')
    print('  python move.py <1-9> --name "<your_name>"')

if __name__ == "__main__":
    main()
