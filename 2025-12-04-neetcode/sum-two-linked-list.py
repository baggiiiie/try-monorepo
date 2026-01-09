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
    def addTwoNumbers(
        self, l1: Optional[ListNode], l2: Optional[ListNode]
    ) -> Optional[ListNode]:
        # addition needs to start from the end:
        # 1. Reverse two lists
        # 2. Add with carry, join result to new_list
        # Question:
        # - is the two list same length?
        def reverse_list(head: Optional[ListNode]) -> Optional[ListNode]:
            prev = None
            curr = head
            while curr:
                next_node = curr.next
                curr.next = prev
                prev = curr
                curr = next_node
            return prev

        list1, list2 = reverse_list(l1), reverse_list(l2)
        curr = new_list = ListNode(0)

        carry = 0
        while list1 and list2:
            new_sum = list1.val + list2.val + carry
            # max of new_sum = 9 + 9 + 1
            carry = 1 if new_sum > 9 else 0
            new_sum = new_sum % 10
            curr.next = ListNode(new_sum)
            list1, list2 = list1.next, list2.next
            curr = curr.next
        # if one list still has next_node, add rest of the list up
        rest = list1 or list2
        if rest:
            rest.val += carry
        curr.next = rest

        if carry:
            curr.next = ListNode(carry)
            return reverse_list(new_list)
        return reverse_list(new_list.next)


if __name__ == "__main__":
    # Test cases
    s = Solution()
    list1 = ListNode(1, ListNode(2, ListNode(9)))
    list2 = ListNode(1, ListNode(3, ListNode(4)))
    print_linked_list(s.addTwoNumbers(list1, list2))
    list1 = ListNode(9)
    list2 = ListNode(9)
    print_linked_list(s.addTwoNumbers(list1, list2))
