from typing import List, Optional


# Definition for singly-linked list.
class ListNode:
    def __init__(self, val=0, next=None):
        self.val = val
        self.next = next

    def __repr__(self) -> str:
        return f"<value: {self.val}, next: {self.next}>"


class Solution:
    def mergeTwoLists(
        self, list1: Optional[ListNode], list2: Optional[ListNode]
    ) -> Optional[ListNode]:
        # compare the heads of the two lists
        # point curr.next to the smaller one
        # move the smaller head to its next node
        # move curr to to curr.next
        # when one list finishes, append rest of the other list to tail

        # dummy points to a None node whose next node is the new head
        curr = dummy = ListNode()

        while list1 and list2:
            if list1.val < list2.val:
                curr.next = list1
                curr = curr.next
                list1 = list1.next
            else:
                curr.next = list2
                curr = curr.next
                list2 = list2.next

        curr.next = list1 or list2

        return dummy.next

    def mergeTwoListsRecursive(
        self, list1: Optional[ListNode], list2: Optional[ListNode]
    ) -> Optional[ListNode]:
        # base case:
        # - when there's one or more empty list, return the other list or None
        #
        # break down to sub-problems:
        # - what should be returned back to call stack: head of list
        #
        # states between problems:
        # - next one in the list

        if not list1 or not list2:
            return list1 or list2

        return list1
        pass


if __name__ == "__main__":
    # Test cases
    s = Solution()
    list1 = ListNode(1, ListNode(2, ListNode(4)))
    list2 = ListNode(1, ListNode(3, ListNode(4)))
    head = s.mergeTwoLists(list1, list2)

    current = head
    while current:
        print(current.val, end=" -> ")
        current = current.next
    print()
