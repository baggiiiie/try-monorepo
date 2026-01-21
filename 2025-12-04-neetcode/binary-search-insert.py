class Solution:
    def searchInsert(self, nums: List[int], target: int) -> int:
        left, right = 0, len(nums) - 1
        while left <= right:
            mid = left + (right - left) // 2
            if nums[mid] > target:
                # go to left side
                right = mid - 1
            elif nums[mid] < target:
                left = mid + 1
            else:
                return mid

        return left


if __name__ == '__main__':
    test_cases = [
        ([-1,0,2,4,6,8],4,3),
        ([-1,0,2,4,6,8],10,6),
        ([-1,0,2,4,6,8],1,2),
        ([-1,0,2,4,6,8],-2,0),
    ]
    s = Solution()
    for nums, target, expected in test_cases:
        res = s.searchInsert(nums, target)
        if res == expected:
            print("passed")
        else:
            print(f"res is {res}, expected is {expected}")
