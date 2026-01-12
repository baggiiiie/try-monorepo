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
        # loop through and sum
        carry = 0
        curr = new_head = ListNode(0)
        while l1 or l2 or carry:
            if not l1:
                l1 = ListNode(0)
            if not l2:
                l2 = ListNode(0)
            list_sum = l1.val + l2.val + carry  # maximum: 9+9+1 = 19
            carry, list_sum = divmod(list_sum, 10)
            curr.next = ListNode(list_sum)
            l1, l2 = l1.next, l2.next
            curr = curr.next

        return new_head.next


if __name__ == "__main__":
    # Test cases
    s = Solution()
    list1 = ListNode(1, ListNode(2, ListNode(3)))
    list2 = ListNode(4, ListNode(5, ListNode(6)))
    print_linked_list(s.addTwoNumbers(list1, list2))
    list1 = ListNode(9)
    list2 = ListNode(9)
    print_linked_list(s.addTwoNumbers(list1, list2))
    list1 = ListNode(9, ListNode(9, ListNode(9)))
    list2 = ListNode(9)
    print_linked_list(s.addTwoNumbers(list1, list2))
    list1 = ListNode(1, ListNode(8))
    list2 = ListNode(0)
    print_linked_list(s.addTwoNumbers(list1, list2))
