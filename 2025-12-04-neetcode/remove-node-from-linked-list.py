from typing import Optional


def print_linked_list(head):
    while head:
        print(head.val, end=" -> ")
        head = head.next
    print("[null]")


# Definition for singly-linked list.
class ListNode:
    def __init__(self, val=0, next=None):
        self.val = val
        self.next = next

    def __repr__(self) -> str:
        return f"<value: {self.val}, next: {self.next}>"


class Solution:
    def removeNthFromEnd(self, head: Optional[ListNode], n: int) -> Optional[ListNode]:
        dummy = ListNode(0, head)
        fast_ptr = slow_ptr = dummy

        # shift fast_ptr forward
        for _ in range(n + 1):
            fast_ptr = fast_ptr.next

        # shift both pointers to desired position
        while fast_ptr:
            fast_ptr, slow_ptr = fast_ptr.next, slow_ptr.next

        # slow_ptr is now the previous node before the node to be removed
        assert slow_ptr is not None
        assert slow_ptr.next is not None
        slow_ptr.next = slow_ptr.next.next

        return dummy.next


if __name__ == "__main__":
    # Test cases
    s = Solution()
    test_cases = [
        (ListNode(2, ListNode(4, ListNode(6, ListNode(8)))), 1),
        (ListNode(2, ListNode(4, ListNode(6, ListNode(8, ListNode(10, None))))), 3),
        (ListNode(1, None), 1),
        (ListNode(1, ListNode(2, None)), 2),
    ]
    for linked_list, idx in test_cases:
        head = s.removeNthFromEnd(linked_list, idx)
        print_linked_list(head)
        print()
