class Solution:
    def search(self, nums: List[int], target: int) -> int:
        pass


if __name__ == '__main__':
    test_cases = [
        ([3,4,5,6,1,2], 1, 4),
        ([3,5,6,0,1,2], 4, -1),
    ]
    s = Solution()
    for nums, target, expected in test_cases:
        res = s.search(nums, target)
        if res == expected:
            print("passed")
        else:
            print(f"res is {res}, expected is {expected}")

