#!/usr/bin/env python3
"""
Block until it's your turn (or the game ends).

Usage:
    python wait_for_turn.py --name "Claude"
    python wait_for_turn.py --name "Claude" --auto-play --quiet

Exit codes:
    0  = it's your turn now
    1  = game is over (check status.py for result)
    2  = error (not in game, no game found, etc.)
"""
import sys
import os
import time
import argparse
sys.path.insert(0, os.path.dirname(__file__))

from game import (
    GameError,
    apply_move,
    choose_best_move,
    find_player_symbol,
    format_board,
    load_state,
    save_state,
)

RESET  = "\033[0m"
DIM    = "\033[2m"
BOLD   = "\033[1m"
CYAN   = "\033[96m"
GREEN  = "\033[92m"
YELLOW = "\033[93m"
RED    = "\033[91m"

SPINNER = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏"


def clear_status_line():
    print("\r" + (" " * 80) + "\r", end="", flush=True)


def print_game_result(state, symbol):
    winner = state.get("winner")
    msg = state.get("message", "Game over.")
    if winner == symbol:
        print(f"\n{GREEN}{BOLD}You win! {msg}{RESET}")
    elif winner == "draw":
        print(f"\n{YELLOW}{msg}{RESET}")
    else:
        print(f"\n{RED}{msg}{RESET}")


def auto_play_turn(state, name, symbol):
    position = choose_best_move(state["board"], symbol)
    apply_move(state, name, position)
    save_state(state)

    print(f"{GREEN}{BOLD}Auto-play:{RESET} {name} ({symbol}) played position {position}")
    print(format_board(state["board"]))
    if state["status"] != "done":
        print(f"  {state['message']}")
    return position

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--name", "-n", required=True, help="Your player name")
    parser.add_argument("--interval", type=float, default=0.4, help="Poll interval in seconds")
    parser.add_argument("--quiet", action="store_true", help="Suppress spinner output while waiting")
    parser.add_argument(
        "--auto-play",
        action="store_true",
        help="Keep waiting, make the best move automatically, and continue until the game ends",
    )
    args = parser.parse_args()

    name = args.name
    tick = 0

    while True:
        state = load_state()

        if state is None:
            print(f"{RED}No game found. Run: python new_game.py{RESET}")
            sys.exit(2)

        players = state["players"]
        symbol = find_player_symbol(players, name)

        if symbol is None:
            print(f"{RED}'{name}' is not in this game.{RESET}")
            print(f"Current players: {players}")
            print(f"Join with: python join.py \"{name}\"")
            sys.exit(2)

        status = state["status"]

        if status == "done":
            if not args.quiet:
                clear_status_line()
            print_game_result(state, symbol)
            sys.exit(1)

        if status == "waiting":
            if not args.quiet:
                spinner = SPINNER[tick % len(SPINNER)]
                print(f"\r{DIM}{spinner} Waiting for opponent to join...{RESET}   ", end="", flush=True)

        elif status == "playing":
            current = state["current_turn"]
            if current == symbol:
                if not args.quiet:
                    clear_status_line()

                if args.auto_play:
                    try:
                        auto_play_turn(state, name, symbol)
                    except GameError as exc:
                        print(f"{RED}Auto-play failed: {exc}{RESET}")
                        sys.exit(2)

                    if state["status"] == "done":
                        print_game_result(state, symbol)
                        sys.exit(1)
                else:
                    opponent_sym = "O" if symbol == "X" else "X"
                    opponent = players.get(opponent_sym, "opponent")
                    last = state.get("history", [])
                    if last:
                        last_move = last[-1]
                        print(f"\r{GREEN}{BOLD}✓ Your turn!{RESET} {DIM}({opponent} played position {last_move['position']}){RESET}   ")
                    else:
                        print(f"\r{GREEN}{BOLD}✓ Your turn!{RESET} (you go first)   ")
                    sys.exit(0)
            else:
                if not args.quiet:
                    other_name = players.get(current, current)
                    spinner = SPINNER[tick % len(SPINNER)]
                    print(f"\r{DIM}{spinner} Waiting for {other_name} to move...{RESET}   ", end="", flush=True)

        time.sleep(args.interval)
        tick += 1

if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print(f"\n{DIM}Interrupted.{RESET}")
        sys.exit(2)
