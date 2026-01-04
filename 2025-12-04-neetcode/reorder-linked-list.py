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
        # break list into halves
        # go to middle (length / 2)
        # - list1: head to length / 2;
        # - list2: length/2 +1 : length
        # sort list2
        # join list1 list2
        if not head or not head.next:
            return

        # get head of 2nd half of the list
        slow_p, fast_p = head, head.next
        while fast_p and fast_p.next and slow_p:
            slow_p = slow_p.next
            fast_p = fast_p.next.next

        assert slow_p is not None
        list2 = slow_p.next
        slow_p.next = None

        # reverse the second list
        prev = None
        while list2:
            next_node = list2.next
            list2.next = prev
            prev = list2
            list2 = next_node
        list2 = prev

        # join two lists
        list1 = head
        while list1 and list2:
            list1_next, list2_next = list1.next, list2.next
            list1.next = list2
            list2.next = list1_next
            list1, list2 = list1_next, list2_next


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
