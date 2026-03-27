"""Shared game logic and state management via a JSON file."""
import json
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

PREFERRED_MOVE_ORDER = [4, 0, 2, 6, 8, 1, 3, 5, 7]


class GameError(Exception):
    """Raised when a requested game action is invalid."""

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


def format_board(board):
    rows = board_to_display(board)
    return "\n".join([
        "",
        f"  {rows[0][0]} | {rows[0][1]} | {rows[0][2]}",
        "  ---------",
        f"  {rows[1][0]} | {rows[1][1]} | {rows[1][2]}",
        "  ---------",
        f"  {rows[2][0]} | {rows[2][1]} | {rows[2][2]}",
        "",
    ])


def find_player_symbol(players, name):
    for sym, player_name in players.items():
        if player_name == name:
            return sym
    return None


def other_symbol(symbol):
    return "O" if symbol == "X" else "X"


def available_indexes(board):
    return [idx for idx in PREFERRED_MOVE_ORDER if board[idx] == " "]


def choose_best_move(board, symbol):
    if symbol not in ("X", "O"):
        raise GameError(f"Symbol must be X or O, got {symbol!r}.")

    opponent = other_symbol(symbol)

    def minimax(current_symbol, depth):
        winner = check_winner(board)
        if winner == symbol:
            return 10 - depth
        if winner == opponent:
            return depth - 10
        if is_draw(board):
            return 0

        scores = []
        for idx in available_indexes(board):
            board[idx] = current_symbol
            scores.append(minimax(other_symbol(current_symbol), depth + 1))
            board[idx] = " "

        if current_symbol == symbol:
            return max(scores)
        return min(scores)

    best_score = None
    best_move = None
    for idx in available_indexes(board):
        board[idx] = symbol
        score = minimax(opponent, 1)
        board[idx] = " "
        if best_score is None or score > best_score:
            best_score = score
            best_move = idx

    if best_move is None:
        raise GameError("No legal moves are available.")

    return best_move + 1


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
