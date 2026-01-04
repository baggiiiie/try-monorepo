from typing import Optional


def print_linked_list(head):
    while head:
        print(head.val, end=" -> ")
        head = head.next
    print()


# Definition for singly-linked list.
class ListNode:
    def __init__(self, val=0, next=None):
        self.val = val
        self.next = next

    def __repr__(self) -> str:
        return f"<value: {self.val}, next: {self.next}>"


class Solution:
    def removeNthFromEnd(self, head: Optional[ListNode], n: int) -> Optional[ListNode]:
        pass


if __name__ == "__main__":
    # Test cases
    s = Solution()
    test_cases = [
        ListNode(2, ListNode(4, ListNode(6, ListNode(8)))),
        ListNode(2, ListNode(4, ListNode(6, ListNode(8, ListNode(10, None))))),
        ListNode(1, None),
    ]
    for test_case in test_cases:
        s.removeNthFromEnd(test_case)
        print_linked_list(test_case)
        print()
