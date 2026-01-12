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
        return f"<value: {self.val}>"


class Solution:
    def reverseBetween(
        self, head: Optional[ListNode], left: int, right: int
    ) -> Optional[ListNode]:
        # two pointers
        # 1. move left_ptr to position left
        # 2. continue to move right pointer to PositionRight (moving times: right - left)
        # 3. reverse linked list between left/right pointers
        # done?
        # note: head might change
        left_ptr = head
        prev = dummy = ListNode(0, head)
        # move left_ptr
        for _ in range(1, left):
            # assuming left and right are <= length of linked list
            assert left_ptr is not None
            prev = left_ptr
            left_ptr = left_ptr.next
        # move right_ptr
        right_ptr = left_ptr
        for _ in range(right - left):
            assert right_ptr is not None
            right_ptr = right_ptr.next

        assert right_ptr is not None
        next_node = right_ptr.next

        prev.next = right_ptr
        prev = next_node
        # reverse between left_ptr and right_ptr
        curr = left_ptr
        while curr and curr is not next_node:
            next_node_2 = curr.next
            curr.next = prev
            prev = curr
            curr = next_node_2

        return dummy.next

    def reverseBetweenOnePass(
        self, head: Optional[ListNode], left: int, right: int
    ) -> Optional[ListNode]:
        # head might change (when left == 1), need dummy node
        # loop through the linked list
        # from start to left:
        # - move left_ptr, keep track of prev
        # - when loop breaks, prev is what needs to point to the right_ptr
        # from left to right:
        # - reverse the list
        # - when loop breaks, next_node is left_ptr should point to
        if not head:
            return
        dummy = ListNode(0, head)
        curr = dummy
        for _ in range(left - 1):
            curr = curr.next
        assert curr is not None
        prev_node = curr
        left_node = curr.next

        assert left_node is not None
        curr = left_node
        tmp_prev = None
        for _ in range(left, right + 1):
            assert curr is not None
            tmp_next = curr.next
            curr.next = tmp_prev
            tmp_prev = curr
            curr = tmp_next
        prev_node.next = tmp_prev
        left_node.next = curr
        print(tmp_prev, curr)
        return dummy.next


if __name__ == "__main__":
    # Test cases
    s = Solution()
    test_cases = [
        (ListNode(2, ListNode(4, ListNode(6, ListNode(8)))), 2, 3),
        (ListNode(2, ListNode(4, ListNode(6, ListNode(8, ListNode(10, None))))), 1, 3),
    ]
    for linked_list, left, right in test_cases:
        head = s.reverseBetweenOnePass(linked_list, left, right)
        print_linked_list(head)
        print()
