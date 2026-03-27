#!/usr/bin/env python3
"""
Live TUI board viewer — run this in your terminal while playing.

Usage:
    python watch.py [--interval 0.5]

The board updates automatically. Press Ctrl+C to quit.
"""
import sys
import os
import time
import argparse
sys.path.insert(0, os.path.dirname(__file__))

from game import load_state

# ANSI escape codes
RESET   = "\033[0m"
BOLD    = "\033[1m"
DIM     = "\033[2m"
ITALIC  = "\033[3m"
RED     = "\033[91m"
BLUE    = "\033[94m"
YELLOW  = "\033[93m"
GREEN   = "\033[92m"
CYAN    = "\033[96m"
MAGENTA = "\033[95m"
WHITE   = "\033[97m"
BG_DARK = "\033[40m"
CLEAR   = "\033[2J\033[H"   # clear screen + move to top
HIDE_CURSOR = "\033[?25l"
SHOW_CURSOR = "\033[?25h"

WIN_LINES = [
    [0, 1, 2], [3, 4, 5], [6, 7, 8],
    [0, 3, 6], [1, 4, 7], [2, 5, 8],
    [0, 4, 8], [2, 4, 6],
]

def get_win_cells(board):
    for line in WIN_LINES:
        a, b, c = line
        if board[a] != " " and board[a] == board[b] == board[c]:
            return set(line)
    return set()

def cell_str(cell, idx, win_cells):
    highlighted = idx in win_cells
    if cell == "X":
        style = f"{BOLD}{RED}"
        if highlighted:
            style = f"{BOLD}\033[101m{RED}"  # red bg
        return f"{style}X{RESET}"
    elif cell == "O":
        style = f"{BOLD}{BLUE}"
        if highlighted:
            style = f"{BOLD}\033[104m{BLUE}"  # blue bg
        return f"{style}O{RESET}"
    else:
        return f"{DIM}{ITALIC}{idx + 1}{RESET}"

def render(state, tick):
    lines = []
    board = state["board"]
    players = state["players"]
    status = state["status"]
    win_cells = get_win_cells(board) if status == "done" else set()

    lines.append("")
    lines.append(f"  {BOLD}{CYAN}╔══════════════════╗{RESET}")
    lines.append(f"  {BOLD}{CYAN}║  TIC · TAC · TOE ║{RESET}")
    lines.append(f"  {BOLD}{CYAN}╚══════════════════╝{RESET}")
    lines.append("")

    # Player roster
    x_name = players.get("X", f"{DIM}waiting...{RESET}")
    o_name = players.get("O", f"{DIM}waiting...{RESET}")
    x_label = f"{BOLD}{RED}✕ {x_name}{RESET}"
    o_label = f"{BOLD}{BLUE}○ {o_name}{RESET}"

    # Highlight current turn
    if status == "playing":
        turn = state["current_turn"]
        if turn == "X":
            x_label = f"{BOLD}{RED}▶ {x_name}{RESET}"
        else:
            o_label = f"{BOLD}{BLUE}▶ {o_name}{RESET}"

    lines.append(f"  {x_label}   {o_label}")
    lines.append("")

    # Board
    divider = f"  {DIM}━━━━━┿━━━━━┿━━━━━{RESET}"
    for row_idx in range(3):
        cells = []
        for col_idx in range(3):
            idx = row_idx * 3 + col_idx
            cells.append(f"  {cell_str(board[idx], idx, win_cells)}  ")
        lines.append(f"  {'┃'.join(cells)}")
        if row_idx < 2:
            lines.append(divider)

    lines.append("")

    # Status message
    msg = state.get("message", "")
    if status == "done":
        winner = state.get("winner")
        if winner == "draw":
            lines.append(f"  {YELLOW}{BOLD}🤝  Draw! Well played.{RESET}")
        else:
            win_name = players.get(winner, winner)
            lines.append(f"  {GREEN}{BOLD}🎉  {win_name} wins!{RESET}")
        lines.append(f"  {DIM}Run 'python new_game.py' to play again.{RESET}")
    elif status == "playing":
        turn = state["current_turn"]
        turn_name = players.get(turn, "?")
        sym = f"{BOLD}{RED}✕{RESET}" if turn == "X" else f"{BOLD}{BLUE}○{RESET}"
        spinner = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏"[tick % 10]
        lines.append(f"  {DIM}{spinner}{RESET}  {sym}  {turn_name}'s turn")
        lines.append(f"  {DIM}  python move.py <1-9> --name \"{turn_name}\"{RESET}")
    else:
        lines.append(f"  {MAGENTA}{msg}{RESET}")
        lines.append("")
        lines.append(f"  {DIM}Join with: python join.py <name>{RESET}")

    # Move history
    history = state.get("history", [])
    if history:
        lines.append("")
        moves = []
        for h in history:
            sym = f"{RED}✕{RESET}" if h["symbol"] == "X" else f"{BLUE}○{RESET}"
            moves.append(f"{sym}{DIM}{h['position']}{RESET}")
        lines.append(f"  {DIM}Moves:{RESET}  " + " → ".join(moves))

    lines.append("")
    lines.append(f"  {DIM}Refreshing every 0.5s  •  Ctrl+C to quit{RESET}")
    lines.append("")

    return "\n".join(lines)

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--interval", type=float, default=0.5,
                        help="Refresh interval in seconds (default: 0.5)")
    args = parser.parse_args()

    print(HIDE_CURSOR, end="", flush=True)
    tick = 0
    last_state_json = None

    try:
        while True:
            state = load_state()

            if state is None:
                output = (
                    f"\n  {BOLD}{CYAN}TIC-TAC-TOE{RESET}\n\n"
                    f"  {DIM}No game found.{RESET}\n"
                    f"  {DIM}Run: python new_game.py{RESET}\n"
                )
            else:
                import json
                state_json = json.dumps(state)
                output = render(state, tick)
                last_state_json = state_json

            sys.stdout.write(CLEAR + output)
            sys.stdout.flush()

            # Stop auto-refresh on game over (still show final state)
            if state and state.get("status") == "done":
                # Render once more, then pause
                time.sleep(args.interval)
                tick += 1
                sys.stdout.write(CLEAR + render(state, tick))
                sys.stdout.flush()
                # Keep showing but stop the spinner
                try:
                    while True:
                        time.sleep(1)
                except KeyboardInterrupt:
                    break
                break

            time.sleep(args.interval)
            tick += 1

    except KeyboardInterrupt:
        pass
    finally:
        print(SHOW_CURSOR, end="")
        print()

if __name__ == "__main__":
    main()
