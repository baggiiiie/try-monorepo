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

from game import load_state, save_state, check_winner, is_draw

def print_board(board):
    rows = []
    for i in range(0, 9, 3):
        row = []
        for j in range(3):
            cell = board[i + j]
            if cell == " ":
                cell = str(i + j + 1)
            row.append(cell)
        rows.append(row)
    print()
    print(f"  {rows[0][0]} | {rows[0][1]} | {rows[0][2]}")
    print("  ---------")
    print(f"  {rows[1][0]} | {rows[1][1]} | {rows[1][2]}")
    print("  ---------")
    print(f"  {rows[2][0]} | {rows[2][1]} | {rows[2][2]}")
    print()

def main():
    parser = argparse.ArgumentParser(description="Make a move in Tic-Tac-Toe")
    parser.add_argument("position", type=int, help="Position 1-9")
    parser.add_argument("--name", "-n", required=True, help="Your player name")
    args = parser.parse_args()

    pos = args.position
    name = args.name

    if pos < 1 or pos > 9:
        print("Error: Position must be between 1 and 9.")
        sys.exit(1)

    state = load_state()
    if state is None:
        print("No game found. Run: python new_game.py")
        sys.exit(1)

    if state["status"] == "waiting":
        print("Game hasn't started yet. Waiting for both players to join.")
        print("Current players:", state["players"])
        sys.exit(1)

    if state["status"] == "done":
        print(f"Game is already over. {state['message']}")
        print_board(state["board"])
        sys.exit(1)

    # Find this player's symbol
    players = state["players"]
    symbol = None
    for sym, n in players.items():
        if n == name:
            symbol = sym
            break

    if symbol is None:
        print(f"Player '{name}' is not in this game.")
        print("Current players:", players)
        print("Join with: python join.py <your_name>")
        sys.exit(1)

    # Check turn
    if state["current_turn"] != symbol:
        other_sym = state["current_turn"]
        print(f"Not your turn! It's {players[other_sym]}'s turn ({other_sym}).")
        sys.exit(1)

    # Check cell
    idx = pos - 1
    if state["board"][idx] != " ":
        print(f"Position {pos} is already taken by {state['board'][idx]}.")
        print_board(state["board"])
        sys.exit(1)

    # Make the move
    state["board"][idx] = symbol
    move_record = {"player": name, "symbol": symbol, "position": pos}
    state["history"].append(move_record)

    winner = check_winner(state["board"])
    if winner:
        state["status"] = "done"
        state["winner"] = winner
        state["message"] = f"🎉 {players[winner]} ({winner}) wins!"
        state["current_turn"] = None
    elif is_draw(state["board"]):
        state["status"] = "done"
        state["winner"] = "draw"
        state["message"] = "It's a draw! Well played both."
        state["current_turn"] = None
    else:
        next_turn = "O" if symbol == "X" else "X"
        state["current_turn"] = next_turn
        state["message"] = f"{players[next_turn]}'s turn ({next_turn})"

    save_state(state)

    print(f"✓ {name} ({symbol}) played position {pos}")
    print_board(state["board"])
    print(f"  {state['message']}")

    if state["status"] == "done":
        print()
        print("Game over! Run 'python new_game.py' to play again.")

if __name__ == "__main__":
    main()
