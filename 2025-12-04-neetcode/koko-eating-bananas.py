import math

class Solution:
    def minEatingSpeed2(self, piles: List[int], h: int) -> int:
        def get_hours(speed: int):
            return sum([math.ceil(pile/speed) for pile in piles])

        max_speed, min_speed = max(piles), 1
        res = max_speed
        while min_speed <= max_speed:
            speed = (min_speed+max_speed) // 2
            hours = get_hours(speed)
            if hours <= h:  # eating too fast, we can try slower
                res = min(speed, res)
                max_speed = speed - 1
            else:
                min_speed = speed + 1

        return res


    def minEatingSpeed(self, piles: List[int], h: int) -> int:
        # binary search between max and 0
        # - max eating speed is max(piles), eating the largest pile per hours,
        # taking len(piles) to finish

        def get_hours(speed: int):
            return sum([math.ceil(pile/speed) for pile in piles])

        max_speed, min_speed = max(piles), 1

        while min_speed < max_speed:
            speed = (max_speed + min_speed) // 2
            total_time = get_hours(speed)
            if total_time > h:  # needs to be faster
                min_speed = speed+1
            else:
                max_speed = speed

        return max_speed


if __name__ == '__main__':
    test_cases = [
        ([1,4,3,2], 9, 2),
        ([25,10,23,4], 4, 25),
        ([312884470], 968709470, 1),
    ]
    s = Solution()
    for piles, hours, expected in test_cases:
        if (res := s.minEatingSpeed2(piles, hours)) != expected:
            print(f"failed! expected is {expected}, res is {res}")
        else:
            print("passed")
