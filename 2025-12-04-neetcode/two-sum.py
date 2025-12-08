from typing import List


class Solution:
    def twoSum(self, nums: List[int], target: int) -> List[int]:
        # need = { number-needed: index }
        need = {}
        for i, num in enumerate(nums):
            if num in need:
                return [need[num], i]
            need[target - num] = i
        return [0, 0]


if __name__ == "__main__":
    solution = Solution()
    test_cases = [
        ([2, 7, 11, 15], 9),  # Expected output: [0, 1]
        ([3, 2, 4], 6),  # Expected output: [1, 2]
        ([3, 3], 6),  # Expected output: [0, 1]
    ]
    for test_nums, test_target in test_cases:
        result = solution.twoSum(test_nums, test_target)
        print(f"twoSum({test_nums}, {test_target}) = {result}")
