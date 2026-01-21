class Solution:
    def search(self, nums: List[int], target: int) -> int:
        # if exist: return index; else: return -1
        # binary search:
        # - check middle and target
        # -- mid is (left+right) // 2
        # -- if mid > target, left side -> (left, mid)
        # -- if mid < target, right side with mid -> [mid, end]
        # -- if mid = target, return mid index
        if not nums: 
            return
        left, right = 0, len(nums) - 1
        while left <= right:
            mid = (left + right) // 2
            if nums[mid] == target:
                return mid
            elif nums[mid] < target:
                left = mid + 1
            elif nums[mid] > target:
                right = mid - 1
        
        return -1


if __name__ == '__main__':
    test_cases = [
        ([-1,0,2,4,6,8],4,3),
        ([-1,0,2,4,6,8],3,-1),
    ]
    s = Solution()
    for nums, target, expected in test_cases:
        res = s.search(nums, target)
        if res == expected:
            print("passed")
        else:
            print(f"res is {res}, expected is {expected}")
