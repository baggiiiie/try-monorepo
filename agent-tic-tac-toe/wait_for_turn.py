#!/usr/bin/env python3
"""
Block until it's your turn, then print the latest board snapshot.

Usage:
    python wait_for_turn.py --name "Agent"

Exit codes:
    0  = it's your turn now
    1  = game is over
    2  = error (not in game, no game found, etc.)
"""
import argparse
import os
import sys
import time

sys.path.insert(0, os.path.dirname(__file__))

from game import find_player_symbol, format_state_snapshot, load_state

SPINNER = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏"


def clear_status_line():
    print("\r" + (" " * 80) + "\r", end="", flush=True)


def progress_message(state, symbol, tick):
    status = state["status"]
    players = state["players"]

    if status == "waiting":
        return f"{SPINNER[tick % len(SPINNER)]} Waiting for opponent to join..."

    if status == "playing":
        current = state["current_turn"]
        if current == symbol:
            return None

        current_name = players.get(current, current)
        return f"{SPINNER[tick % len(SPINNER)]} Waiting for {current_name} to move..."

    return None


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--name", "-n", required=True, help="Your player name")
    parser.add_argument(
        "--interval", type=float, default=0.4, help="Poll interval in seconds"
    )
    parser.add_argument(
        "--quiet",
        action="store_true",
        help="Suppress progress output while waiting",
    )
    args = parser.parse_args()

    show_progress = sys.stdout.isatty() and not args.quiet
    tick = 0

    while True:
        state = load_state()

        if state is None:
            print("No game found. Run: python new_game.py")
            sys.exit(2)

        players = state["players"]
        symbol = find_player_symbol(players, args.name)

        if symbol is None:
            print(f"'{args.name}' is not in this game.")
            print(f"Current players: {players}")
            print(f'Join with: python join.py "{args.name}"')
            sys.exit(2)

        status = state["status"]
        if status == "done":
            if show_progress:
                clear_status_line()
            print(format_state_snapshot(state, viewer_name=args.name))
            sys.exit(1)

        if status == "playing" and state["current_turn"] == symbol:
            if show_progress:
                clear_status_line()
            print(format_state_snapshot(state, viewer_name=args.name))
            sys.exit(0)

        if show_progress:
            message = progress_message(state, symbol, tick)
            if message:
                print(f"\r{message}", end="", flush=True)

        time.sleep(args.interval)
        tick += 1


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\nInterrupted.")
        sys.exit(2)
