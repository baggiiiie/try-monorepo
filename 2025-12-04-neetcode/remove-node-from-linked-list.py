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
        # brute force:
        # - go through the list, check every time if the next n item is None
        # - O(n^2)
        # better?:
        # - go through list to get length
        # - find (len-n)-th node, point its previous.next to its next
        # - O(n)?
        if not head:
            return None

        dummy = ListNode(0, head)

        right_ptr, left_ptr = head, dummy
        for _ in range(n):
            right_ptr = right_ptr.next

        while right_ptr:
            right_ptr = right_ptr.next
            left_ptr = left_ptr.next
        previous_node = left_ptr

        assert previous_node is not None
        assert previous_node.next is not None
        previous_node.next = previous_node.next.next
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
