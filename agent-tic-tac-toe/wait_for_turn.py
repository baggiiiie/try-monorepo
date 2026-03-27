#!/usr/bin/env python3
"""
Block until it's your turn (or the game ends).

Usage:
    python wait_for_turn.py --name "Claude"

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

from game import load_state

RESET  = "\033[0m"
DIM    = "\033[2m"
BOLD   = "\033[1m"
CYAN   = "\033[96m"
GREEN  = "\033[92m"
YELLOW = "\033[93m"
RED    = "\033[91m"

SPINNER = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏"

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--name", "-n", required=True, help="Your player name")
    parser.add_argument("--interval", type=float, default=0.4, help="Poll interval in seconds")
    args = parser.parse_args()

    name = args.name
    tick = 0

    while True:
        state = load_state()

        if state is None:
            print(f"{RED}No game found. Run: python new_game.py{RESET}")
            sys.exit(2)

        players = state["players"]

        # Find this player's symbol
        symbol = None
        for sym, n in players.items():
            if n == name:
                symbol = sym
                break

        if symbol is None:
            print(f"{RED}'{name}' is not in this game.{RESET}")
            print(f"Current players: {players}")
            print(f"Join with: python join.py \"{name}\"")
            sys.exit(2)

        status = state["status"]

        if status == "done":
            winner = state.get("winner")
            msg = state.get("message", "Game over.")
            if winner == symbol:
                print(f"\n{GREEN}{BOLD}🎉 You win! {msg}{RESET}")
            elif winner == "draw":
                print(f"\n{YELLOW}🤝 {msg}{RESET}")
            else:
                print(f"\n{RED}😞 {msg}{RESET}")
            sys.exit(1)

        if status == "waiting":
            spinner = SPINNER[tick % len(SPINNER)]
            print(f"\r{DIM}{spinner} Waiting for opponent to join...{RESET}   ", end="", flush=True)

        elif status == "playing":
            current = state["current_turn"]
            if current == symbol:
                # Clear the waiting line, print go signal
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
