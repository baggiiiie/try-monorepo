from typing import List, Optional


# Definition for singly-linked list.
class ListNode:
    def __init__(self, val=0, next=None):
        self.val = val
        self.next = next

    def __repr__(self) -> str:
        return f"<value: {self.val}, next: {self.next}>"


class Solution:
    def hasCycle(self, head: Optional[ListNode]) -> bool:
        node_set = set()
        while head:
            if head in node_set:
                return True
            node_set.add(head)
            head = head.next

        return False

    def hasCyclePointers(self, head: Optional[ListNode]) -> bool:
        # let's have two pointers, one moves faster than the other (say, 2x speed)
        # if there's a cycle, the faster pointer will catch up with the slower
        # one from behind
        # return when catchup happens, or when the fast pointer reaches end
        if not head:
            return False
        slow_p, fast_p = head, head.next
        while fast_p and fast_p.next:
            if fast_p is slow_p:
                return True
            slow_p = slow_p.next
            fast_p = fast_p.next.next
        return False


if __name__ == "__main__":
    # Test cases
    s = Solution()
    list1 = ListNode(1, ListNode(2, ListNode(4)))
    print("linked list has cycle:", s.hasCyclePointers(list1))
