import time

class Solution:
    def shipWithinDays2(self, weights: List[int], days: int) -> int:
        def get_total_days(capacity: int):
            total_days = 0
            current_weight, i = 0, 0
            while i < len(weights):
                current_weight += weights[i]
                if current_weight > capacity: 
                    total_days += 1
                    current_weight = 0
                    continue
                i += 1
            return total_days + 1

        min_load, max_load = max(weights), sum(weights)

        while min_load < max_load:  # when loop breaks, min_load == max_load (converges)
            load = (min_load+max_load) // 2            
            days_needed = get_total_days(load)
            if days_needed > days:  # too light! we need heavier load
                # `+1` here because it's already too light, the condition
                # wouldn't be satisfied anyways, so we discard current `load`
                min_load = load + 1  
            else:
                # we can still try to go lighter but we don't wanna discard
                # current `load` as a candidate because `max_load` and
                # `min_load` will converge to this answer
                max_load = load

        return max_load



    def shipWithinDays(self, weights: List[int], days: int) -> int:
        # the minimum of weight limit is >= max(weights)
        # - because the ship should at least be able to send the heaviest
        # - package in 1 day
        # the maximum is sum(weights) -> ship all in one day
        # now we need to find a weight between min and max, that satisfies
        # total_days <= target_days

        def get_total_days(capacity: int):
            total_days = 0
            current_weight, i = 0, 0
            while i < len(weights):
                current_weight += weights[i]
                if current_weight > capacity: 
                    total_days += 1
                    current_weight = 0
                    continue
                i += 1
            return total_days + 1

        min_weight, max_weight = max(weights), sum(weights)
        res = max_weight
        while min_weight <= max_weight:
            weight = (min_weight + max_weight) // 2
            days_needed = get_total_days(weight)
            # print(f"weight is {weight}, days needed is {days_needed}")
            if days_needed <= days:  # we can try lighter load
                res = weight
                max_weight = weight - 1
            else:  # taking too long, need to load heavier
                min_weight = weight + 1
        return res


if __name__ == '__main__':
    test_cases = [
        ([2,4,6,1,3,10], 4, 10),
        ([25,10,23,4], 4, 25),
        ([1,5,4,4,2,3], 3, 8),
    ]
    s = Solution()
    for piles, hours, expected in test_cases:
        if (res := s.shipWithinDays2(piles, hours)) != expected:
            print(f"failed! expected is {expected}, res is {res}")
        else:
            print("passed")
