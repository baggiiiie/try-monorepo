from typing import Optional


# Definition for singly-linked list.
class ListNode:
    def __init__(self, val=0, next=None):
        self.val = val
        self.next = next

    def __repr__(self) -> str:
        return f"<value: {self.val}, next: {self.next}>"


class Solution:
    def reverseListRecursive(self, head: Optional[ListNode]) -> Optional[ListNode]:
        # recursive:
        # 1. Base case
        # 2. Breaking down to sub-problems
        # 3. Pass in states (prev, curr, next)
        # 4. Return back to function call stack

        def reverse(prev, curr: Optional[ListNode]) -> Optional[ListNode]:
            if not curr:
                return prev
            # sub-problem: reverse prev node and curr node
            next_node = curr.next
            curr.next = prev

            return reverse(curr, next_node)

        return reverse(None, head)

    def reverseList(self, head: Optional[ListNode]) -> Optional[ListNode]:
        # keep one pointer to next node, one to prev node
        # point curr to prev
        # move curr to next
        # when curr.next is None, curr is the tail (new head), return curr
        curr, prev = head, None
        # when the while loop breaks, curr is None, prev is tail
        while curr:
            next_node = curr.next
            curr.next = prev
            prev = curr
            curr = next_node
        return prev


if __name__ == "__main__":
    # Example usage:
    # Creating a linked list: 1 -> 2 -> 3 -> None
    head = ListNode(1, ListNode(2, ListNode(3, ListNode(-10, None))))
    current = head
    while current:
        print(current.val, end=" -> ")
        current = current.next
    print()

    solution = Solution()
    reversed_head = solution.reverseListRecursive(head)
    print(reversed_head)

    # Print reversed linked list
    current = reversed_head
    while current:
        print(current.val, end=" -> ")
        current = current.next
    print()
