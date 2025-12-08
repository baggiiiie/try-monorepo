from typing import List
from collections import defaultdict


class Solution:
    def topKFrequent(self, nums: List[int], k: int) -> List[int]:
        # bucket sort:
        # array of slot to put stuff in
        bucket = [[] for _ in range(len(nums) + 1)]
        # { num: frequency }
        freq_map = defaultdict(int)
        for num in nums:
            freq_map[num] += 1
        for num, freq in freq_map.items():
            bucket[freq].append(num)

        res = []
        for idx in range(len(bucket) - 1, 0, -1):
            if bucket[idx] and len(res) < k:
                res.append(*bucket[idx])
        res.sort()
        return res


if __name__ == "__main__":
    s = Solution()
    test_cases = [
        (
            ([1, 2, 2, 3, 3, 3], 2),
            [2, 3],
        ),
        (
            ([7, 7], 1),
            [7],
        ),
    ]
    for data, expected in test_cases:
        nums, k = data
        actual = s.topKFrequent(nums, k)
        if expected != actual:
            print(f"test failed! actual is {actual}")
        else:
            print("test passed")
