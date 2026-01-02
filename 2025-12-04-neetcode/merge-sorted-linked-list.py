from typing import Optional


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
        # set up an empty dummy node
        # compare the heads of two lists
        # point dummy node's next_node to smaller one
        # move heads of two lists to next
        curr = dummy = ListNode()
        while list1 and list2:
            if list1.val > list2.val:
                curr.next = list2
                list2 = list2.next
            else:
                curr.next = list1
                list1 = list1.next
            curr = curr.next
        if list1 or list2:
            curr.next = list1 or list2

        return dummy.next

    def mergeTwoListsRecursive(
        self, list1: Optional[ListNode], list2: Optional[ListNode]
    ) -> Optional[ListNode]:
        # base case:
        # - one list is empty
        # sub problems:
        # - compare the heads of two lists
        # - pass the next_node of smaller head, and the other head to next function call (states)
        # return:
        # - return the head of the smaller head back to call stack
        # - calling function is waiting for the head of a sorted list to be returned
        # - (we don't need a dummy node in this case, the return is already a head)
        if (not list1) or (not list2):
            # base case: either one is empty
            return list1 or list2
        if list1.val < list2.val:
            list1.next = self.mergeTwoListsRecursive(list1.next, list2)
            return list1
        else:
            list2.next = self.mergeTwoListsRecursive(list1, list2.next)
            return list2


if __name__ == "__main__":
    # Test cases
    s = Solution()
    list1 = ListNode(1, ListNode(2, ListNode(4)))
    list2 = ListNode(1, ListNode(3, ListNode(4)))
    head = s.mergeTwoListsRecursive(list1, list2)

    current = head
    while current:
        print(current.val, end=" -> ")
        current = current.next
    print()
