class Solution:
    def mySqrt(self, x: int) -> int:
        left, right = 1, x
        while left <= right:
            mid = left + (right - left) // 2
            if mid*mid > x:
                right = mid - 1
            elif mid*mid < x:
                left = mid + 1
            else: 
                return mid
        return left-1

if __name__ == '__main__':
    test_cases = [
        (9, 3),
        (13, 3),
        (1, 1),
    ]
    s = Solution()
    for n, target in test_cases:
        if (res := s.mySqrt(n)) == target:
            print("passed")
        else:
            print(f"res is {res}, expected is {target}")
