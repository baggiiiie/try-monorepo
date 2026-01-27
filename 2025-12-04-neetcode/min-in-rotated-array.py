class Solution:
    def findMin(self, nums: List[int]) -> int:
        left, right = 0, len(nums) - 1
        res = nums[0]
        while left <= right:  # when loop breaks, left > right
            if nums[left] <= nums[right]: 
                return nums[left]

            mid = left + (right - left) // 2
            if nums[right] < nums[mid]:
                # (mid, right]
                left = mid + 1
            else:
                right = mid
        return -1


    def findMin2(self, nums: List[int]) -> int:
        # we wanna find the unsorted side in nums
        # - if left > mid: left is unsorted
        # - if right < mid: right is unsorted
        # assuming every element is unique
        left, right = 0, len(nums) - 1
        while left < right:  # when loop breaks, left == right
            mid = left + (right - left) // 2
            if nums[right] < nums[mid]:
                # (mid, right] is the side we care about
                left = mid + 1
            else:
                # [left, mid]
                right = mid
        return nums[left]

if __name__ == '__main__':
    test_cases = [
        ([4,5,0,1,2,3], 0),
        ([3,4,5,6,1,2], 1),
        ([4,5,6,7], 4),
        ([3,4,5,1,2], 1),
    ]
    s = Solution()
    for nums, expected in test_cases:
        res = s.findMin(nums)
        if res == expected:
            print("passed")
        else:
            print(f"res is {res}, expected is {expected}")

