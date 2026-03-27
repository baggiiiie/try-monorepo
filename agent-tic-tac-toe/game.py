"""Shared game logic and state management via a JSON file."""
import json
import time
from pathlib import Path

STATE_FILE = Path(__file__).parent / "game_state.json"

WIN_LINES = [
    [0, 1, 2], [3, 4, 5], [6, 7, 8],  # rows
    [0, 3, 6], [1, 4, 7], [2, 5, 8],  # cols
    [0, 4, 8], [2, 4, 6],              # diags
]


class GameError(Exception):
    """Raised when a requested game action is invalid."""


def new_state():
    return {
        "board": [" "] * 9,
        "players": {},
        "current_turn": "X",
        "status": "waiting",
        "winner": None,
        "message": "Waiting for players to join...",
        "history": [],
        "created_at": None,
    }

def load_state():
    if STATE_FILE.exists():
        with open(STATE_FILE) as f:
            return json.load(f)
    return None

def save_state(state):
    with open(STATE_FILE, "w") as f:
        json.dump(state, f, indent=2)

def init_game():
    state = new_state()
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


def board_lines(board):
    rows = board_to_display(board)
    return [
        f"  {rows[0][0]} | {rows[0][1]} | {rows[0][2]}",
        "  ---------",
        f"  {rows[1][0]} | {rows[1][1]} | {rows[1][2]}",
        "  ---------",
        f"  {rows[2][0]} | {rows[2][1]} | {rows[2][2]}",
    ]


def format_board(board):
    return "\n".join(board_lines(board))


def find_player_symbol(players, name):
    for sym, player_name in players.items():
        if player_name == name:
            return sym
    return None


def other_symbol(symbol):
    return "O" if symbol == "X" else "X"


def format_state_snapshot(state, viewer_name=None):
    players = state["players"]
    viewer_symbol = find_player_symbol(players, viewer_name) if viewer_name else None
    history = state.get("history", [])
    lines = []

    x_name = players.get("X", "---")
    o_name = players.get("O", "---")
    lines.append(f"Players: X={x_name}  O={o_name}")

    if viewer_name:
        if viewer_symbol is None:
            lines.append(f"You: {viewer_name} (not joined)")
        else:
            lines.append(f"You: {viewer_name} ({viewer_symbol})")

    lines.append("Board:")
    lines.extend(board_lines(state["board"]))

    if history:
        last_move = history[-1]
        lines.append(
            f"Last move: {last_move['player']} ({last_move['symbol']}) -> {last_move['position']}"
        )

    status = state["status"]
    if status == "waiting":
        lines.append("Status: waiting for both players to join")
    elif status == "playing":
        current = state["current_turn"]
        current_name = players.get(current, current)
        if viewer_symbol == current:
            lines.append(f"Status: your turn ({current})")
        else:
            lines.append(f"Status: {current_name}'s turn ({current})")
    elif status == "done":
        winner = state.get("winner")
        if winner == "draw":
            lines.append("Status: game over (draw)")
        else:
            winner_name = players.get(winner, winner)
            lines.append(f"Status: game over ({winner_name} won as {winner})")

    message = state.get("message")
    if message:
        lines.append(f"Message: {message}")

    return "\n".join(lines)


def apply_move(state, name, pos):
    if pos < 1 or pos > 9:
        raise GameError("Position must be between 1 and 9.")

    if state is None:
        raise GameError("No game found. Run: python new_game.py")

    if state["status"] == "waiting":
        raise GameError("Game hasn't started yet. Waiting for both players to join.")

    if state["status"] == "done":
        raise GameError(f"Game is already over. {state['message']}")

    players = state["players"]
    symbol = find_player_symbol(players, name)
    if symbol is None:
        raise GameError(
            f"Player '{name}' is not in this game. Join with: python join.py <your_name>"
        )

    if state["current_turn"] != symbol:
        current = state["current_turn"]
        raise GameError(f"Not your turn! It's {players[current]}'s turn ({current}).")

    idx = pos - 1
    if state["board"][idx] != " ":
        raise GameError(f"Position {pos} is already taken by {state['board'][idx]}.")

    state["board"][idx] = symbol
    state["history"].append({"player": name, "symbol": symbol, "position": pos})

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
        next_turn = other_symbol(symbol)
        state["current_turn"] = next_turn
        state["message"] = f"{players[next_turn]}'s turn ({next_turn})"

    return symbol
