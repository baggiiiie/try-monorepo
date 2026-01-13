from typing import List


class Solution:
    def findDuplicate2(self, nums: List[int]) -> int:
        # Phase 1: Find intersection point in the cycle
        slow = nums[0]
        fast = nums[0]

        # Move until they meet
        while True:
            slow = nums[slow]
            fast = nums[nums[fast]]
            if slow == fast:
                break
        print("loop 1 finishes: ", slow, fast)

        # Phase 2: Find the entrance to the cycle (the duplicate)
        slow = nums[0]
        while slow != fast:
            print("loop 2: ", slow, fast)
            slow = nums[slow]
            fast = nums[fast]

        return slow

    def findDuplicate(self, nums: List[int]) -> int:
        # treat array like a linked list
        # each element is the next node to go to
        # fast_ptr and slow_ptr: if fast_ptr == slow_ptr, return num
        if len(nums) < 2:
            return -1

        slow_ptr, fast_ptr = nums[0], nums[0]
        while True:
            # if there's no duplicate, after this loop, the whole list should be iterated through
            if slow_ptr == fast_ptr:
                break
            slow_ptr = nums[slow_ptr]
            fast_ptr = nums[nums[fast_ptr]]

        slow_ptr = nums[0]
        while slow_ptr != fast_ptr:
            slow_ptr = nums[slow_ptr]
            fast_ptr = nums[fast_ptr]
        return slow_ptr


if __name__ == "__main__":
    test_cases = [
        # ([1, 2, 3, 2, 2], 2),
        # ([1, 2, 3, 4, 4], 4),
        # ([1, 4, 2, 3, 3], 3),
        # ([1, 4, 2, 3, 4], 4),
        ([1, 3, 4, 2, 2], 2),
        # ([1, 1], 1),
    ]
    s = Solution()
    for nums, expected in test_cases:
        if (res := s.findDuplicate2(nums)) != expected:
            print(f"failed:\n- array {nums}, expected {expected}\n- res is {res}")
        else:
            print("pass")
