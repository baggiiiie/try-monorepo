import sys
import tty
import termios

ESC = "\x1b"

def read_key():
    # get file descriptor for stdin
    fd = sys.stdin.fileno()
    # save current terminal settings
    old = termios.tcgetattr(fd)
    try:
        # disable line buffering and echo so we get each keypress immediately
        tty.setraw(fd)
        # read one byte
        ch = sys.stdin.read(1)
        # if it's an escape byte (0x1b), an escape sequence may follow
        if ch == ESC:
            # read the next byte
            ch2 = sys.stdin.read(1)
            # CSI (Control Sequence Introducer): ESC [ means an arrow/special key
            if ch2 == "[":
                # read the final byte: A=up, B=down, C=right, D=left
                ch3 = sys.stdin.read(1)
                return ESC + "[" + ch3
        # regular key, just return the single character
        return ch
    finally:
        # restore original terminal settings
        termios.tcsetattr(fd, termios.TCSADRAIN, old)

row, col = 10, 10
print(f"{ESC}[2J{ESC}[{row};{col}H", end="", flush=True)
print("X", end="", flush=True)

last_key = ""
while True:
    key = read_key()
    last_key = key
    if key == "q":
        break
    elif key == f"{ESC}[A":
        row = max(1, row - 1)
    elif key == f"{ESC}[B":
        row += 1
    elif key == f"{ESC}[C":
        col += 1
    elif key == f"{ESC}[D":
        col = max(1, col - 1)

    key_bytes = " ".join(f"0x{b:02x}" for b in last_key.encode())
    key_repr = repr(last_key)
    print(f"{ESC}[2J{ESC}[1;1H", end="", flush=True)
    print(f"bytes: {key_bytes}  repr: {key_repr}", end="", flush=True)
    print(f"{ESC}[{row};{col}H", end="", flush=True)
    print("X", end="", flush=True)

print(f"{ESC}[2J{ESC}[1;1H", end="", flush=True)
