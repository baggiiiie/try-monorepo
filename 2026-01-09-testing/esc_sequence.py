import time

ESC = "\x1b"

print(f"{ESC}[2J{ESC}[10;10H", end="", flush=True)
print("X", end="", flush=True)
time.sleep(1)

print(f"{ESC}[1B", end="", flush=True)
time.sleep(1)

print(f"{ESC}[1B", end="", flush=True)
time.sleep(10)
