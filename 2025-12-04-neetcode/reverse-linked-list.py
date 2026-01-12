from typing import Optional


# Definition for singly-linked list.
class ListNode:
    def __init__(self, val=0, next=None):
        self.val = val
        self.next = next

    def __repr__(self) -> str:
        return f"<value: {self.val}, next: {self.next}>"


class Solution:
    def reverseList(self, head: Optional[ListNode]) -> Optional[ListNode]:
        # go through the linked list
        # keep a temp node for previous node
        # point current node to where temp node points to
        # update temp to point to current
        prev_node = None
        while head:
            next_node = head.next
            head.next = prev_node
            prev_node = head
            head = next_node

        return prev_node

    def reverseListRecursive(self, head: Optional[ListNode]) -> Optional[ListNode]:
        def reverse(curr, prev: Optional[ListNode]) -> Optional[ListNode]:
            # base case
            if not curr:
                print(f"returning {prev}")
                return prev
            next_node = curr.next
            curr.next = prev
            return reverse(next_node, curr)

        res = reverse(head, None)
        print(f"res is {res}")
        return res


if __name__ == "__main__":
    # Example usage:
    # Creating a linked list: 1 -> 2 -> 3 -> None
    head = ListNode(1, ListNode(2, ListNode(3, None)))
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
