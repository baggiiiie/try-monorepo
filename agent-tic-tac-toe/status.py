#!/usr/bin/env python3
"""Print the current game state (one-shot, no live refresh)."""
import sys
import os
sys.path.insert(0, os.path.dirname(__file__))

from game import load_state

RESET  = "\033[0m"
BOLD   = "\033[1m"
DIM    = "\033[2m"
RED    = "\033[91m"
BLUE   = "\033[94m"
YELLOW = "\033[93m"
GREEN  = "\033[92m"
CYAN   = "\033[96m"

def color_cell(cell):
    if cell == "X":
        return f"{BOLD}{RED}X{RESET}"
    elif cell == "O":
        return f"{BOLD}{BLUE}O{RESET}"
    else:
        return f"{DIM}{cell}{RESET}"

def main():
    state = load_state()
    if state is None:
        print("No game found. Run: python new_game.py")
        sys.exit(1)

    players = state["players"]
    board = state["board"]

    print()
    print(f"{BOLD}{CYAN}  TIC-TAC-TOE{RESET}")
    print()

    # Players
    x_name = players.get("X", "---")
    o_name = players.get("O", "---")
    print(f"  {BOLD}{RED}X{RESET}: {x_name}   {BOLD}{BLUE}O{RESET}: {o_name}")
    print()

    # Board
    rows = []
    for i in range(0, 9, 3):
        row = []
        for j in range(3):
            cell = board[i + j]
            display = cell if cell != " " else str(i + j + 1)
            row.append(color_cell(display))
        rows.append(row)

    sep = f"  {DIM}---+---+---{RESET}"
    print(f"   {rows[0][0]} | {rows[0][1]} | {rows[0][2]}")
    print(sep)
    print(f"   {rows[1][0]} | {rows[1][1]} | {rows[1][2]}")
    print(sep)
    print(f"   {rows[2][0]} | {rows[2][1]} | {rows[2][2]}")
    print()

    # Status
    status = state["status"]
    msg = state["message"]
    if status == "done":
        winner = state.get("winner")
        if winner == "draw":
            print(f"  {YELLOW}Draw!{RESET} {msg}")
        else:
            print(f"  {GREEN}{msg}{RESET}")
    elif status == "playing":
        turn = state["current_turn"]
        turn_name = players.get(turn, "?")
        sym_colored = f"{BOLD}{RED}X{RESET}" if turn == "X" else f"{BOLD}{BLUE}O{RESET}"
        print(f"  {sym_colored} {turn_name}'s turn")
    else:
        print(f"  {DIM}{msg}{RESET}")

    # Move history
    history = state.get("history", [])
    if history:
        print()
        print(f"  {DIM}Moves: ", end="")
        moves = [f"{h['symbol']}@{h['position']}" for h in history]
        print(", ".join(moves) + RESET)
    print()

if __name__ == "__main__":
    main()
