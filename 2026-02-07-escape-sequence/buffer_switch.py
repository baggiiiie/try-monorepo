import sys
import time

def switch_to_alt_buffer():
    # ESC [ ? 1049 h
    sys.stdout.write("\x1b[?1049h")
    sys.stdout.flush()

def switch_to_normal_buffer():
    # ESC [ ? 1049 l
    sys.stdout.write("\x1b[?1049l")
    sys.stdout.flush()

def main():
    print("This is the NORMAL screen buffer.")
    print("Press Enter to switch to the ALTERNATIVE buffer...")
    input()

    try:
        switch_to_alt_buffer()
        print("Now you are in the ALTERNATIVE screen buffer!")
        print("Notice that the previous text is gone.")
        print("Waiting 3 seconds before switching back...")

        for i in range(3, 0, -1):
            print(f"Switching back in {i}...")
            time.sleep(1)

    finally:
        switch_to_normal_buffer()
        print("Back in the NORMAL buffer. The original text should be restored above.")

if __name__ == "__main__":
    main()

