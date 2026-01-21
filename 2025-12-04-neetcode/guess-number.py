pick = 0
def guess(n: int):
    global pick
    if n > pick:
        return -1
    if n < pick: 
        return 1
    return 0

class Solution:
    def guessNumber(self, n: int) -> int:
        left, right = 1, n
        while left <= right:
            mid = left + (right - left) // 2
            if guess(mid) == -1:
                right = mid - 1
            elif guess(mid) == 1:
                left = mid + 1
            else:
                return mid


if __name__ == '__main__':
    test_cases = [
        (5, 3),
        (15, 10),
        (1, 1),
    ]
    s = Solution()
    for n, target in test_cases:
        pick = target
        res = s.guessNumber(n)
        if res == pick:
            print("passed")
        else:
            print(f"res is {res}, expected is {pick}")
