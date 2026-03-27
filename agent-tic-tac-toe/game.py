"""Shared game logic and state management via a JSON file."""
import json
import os
import time
from pathlib import Path

STATE_FILE = Path(__file__).parent / "game_state.json"

INITIAL_STATE = {
    "board": [" "] * 9,
    "players": {},       # {"X": "Alice", "O": "Bob"}
    "current_turn": "X",
    "status": "waiting", # waiting | playing | done
    "winner": None,
    "message": "Waiting for players to join...",
    "history": [],
    "created_at": None,
}

WIN_LINES = [
    [0, 1, 2], [3, 4, 5], [6, 7, 8],  # rows
    [0, 3, 6], [1, 4, 7], [2, 5, 8],  # cols
    [0, 4, 8], [2, 4, 6],              # diags
]

def load_state():
    if STATE_FILE.exists():
        with open(STATE_FILE) as f:
            return json.load(f)
    return None

def save_state(state):
    with open(STATE_FILE, "w") as f:
        json.dump(state, f, indent=2)

def init_game():
    state = dict(INITIAL_STATE)
    state["board"] = [" "] * 9
    state["players"] = {}
    state["created_at"] = time.time()
    save_state(state)
    return state

def check_winner(board):
    for line in WIN_LINES:
        a, b, c = line
        if board[a] != " " and board[a] == board[b] == board[c]:
            return board[a]
    return None

def is_draw(board):
    return " " not in board

def board_to_display(board):
    rows = []
    for i in range(0, 9, 3):
        row = []
        for j in range(3):
            cell = board[i + j]
            if cell == " ":
                cell = str(i + j + 1)  # show position number
            row.append(cell)
        rows.append(row)
    return rows
