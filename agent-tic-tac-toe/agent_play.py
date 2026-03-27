#!/usr/bin/env python3
"""
Join a game and keep playing automatically until it ends.

Usage:
    python agent_play.py "Claude"
    python agent_play.py "Claude" X
"""
import argparse
import os
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).parent


def run_step(args):
    completed = subprocess.run([sys.executable, *args], cwd=ROOT)
    return completed.returncode


def main():
    parser = argparse.ArgumentParser(
        description="Join the Tic-Tac-Toe game and auto-play until it ends."
    )
    parser.add_argument("name", help="Player name")
    parser.add_argument(
        "symbol",
        nargs="?",
        default="O",
        choices=("X", "O"),
        help="Preferred symbol to request when joining (default: O)",
    )
    parser.add_argument(
        "--interval",
        type=float,
        default=0.4,
        help="Poll interval to pass to wait_for_turn.py",
    )
    args = parser.parse_args()

    join_code = run_step(["join.py", args.name, args.symbol])
    if join_code != 0:
        sys.exit(join_code)

    wait_code = run_step([
        "wait_for_turn.py",
        "--name",
        args.name,
        "--auto-play",
        "--quiet",
        "--interval",
        str(args.interval),
    ])
    sys.exit(wait_code)


if __name__ == "__main__":
    main()
