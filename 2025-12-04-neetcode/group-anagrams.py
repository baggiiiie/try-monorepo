from typing import List


class Solution:
    def groupAnagrams(self, strs: List[str]) -> List[List[str]]:
        # input: a list of strings
        # output: a list of grouped strings from input
        # use a map to store and group anagrams
        # return values of map as list
        if not strs:
            return []
        group_anagrams = {}
        for element in strs:
            temp = "".join(sorted(element))
            if temp in group_anagrams:
                group_anagrams[temp].append(element)
                continue
            group_anagrams[temp] = [element]

        return [anagram_group for anagram_group in group_anagrams.values()]


if __name__ == "__main__":
    test_cases = [
        (
            ["act", "pots", "tops", "cat", "stop", "hat"],
            [["hat"], ["act", "cat"], ["stop", "pots", "tops"]],
        ),
        (
            ["x"],
            [["x"]],
        ),
        (
            [""],
            [[""]],
        ),
    ]
    solution = Solution()
    for data, expected in test_cases:
        if expected != solution.groupAnagrams(data):
            print("test failed!")
            continue
        print("tests passed")
