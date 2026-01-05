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
    def reorderList(self, head: Optional[ListNode]) -> None:
        if not head or not head.next:
            return

        # step 1: break down list to 2 halves
        slow_ptr, fast_ptr = head, head.next
        assert slow_ptr is not None  # this is only to make lsp shut up
        while fast_ptr and fast_ptr.next:
            fast_ptr = fast_ptr.next.next
            slow_ptr = slow_ptr.next

        assert slow_ptr is not None  # this is only to make lsp shut up
        second_list = slow_ptr.next
        # break the end of first list from linking to start of second list
        slow_ptr.next = None

        # step 2: reverse 2nd list
        prev = None
        while second_list:
            next_node = second_list.next
            second_list.next = prev
            prev = second_list
            second_list = next_node

        # when the while loop breaks, second_list is None
        # prev is the last element, the actual the head of second_list
        second_list = prev

        # step 3: join two lists
        first_list = head
        while second_list:  # len(second_list) <= len(first_list)
            next_1st, next_2nd = first_list.next, second_list.next
            first_list.next = second_list
            second_list.next = next_1st
            first_list, second_list = next_1st, next_2nd


if __name__ == "__main__":
    # Test cases
    s = Solution()
    test_cases = [
        ListNode(2, ListNode(4, ListNode(6, ListNode(8)))),
        ListNode(2, ListNode(4, ListNode(6, ListNode(8, ListNode(10, None))))),
        ListNode(1, None),
    ]
    for test_case in test_cases:
        s.reorderList(test_case)
        print_linked_list(test_case)
        print()
