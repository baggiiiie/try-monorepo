from collections import defaultdict
from typing import Optional


def print_linked_list(head):
    while head:
        if not head.random:
            head.random = Node(-1, None, None)
        msg = f"{head.val}<random: {head.random.val}>"
        print(msg, end=" -> ")
        head = head.next
    print()


# Definition for a Node.
class Node:
    def __init__(
        self,
        x: int,
        next: Optional["Node"] = None,
        random: Optional["Node"] = None,
    ):
        self.val = int(x)
        self.next = next
        self.random = random

    def __repr__(self):
        return f"<Node: {self.val}, {self.next}>"


class Solution:
    def copyRandomList(self, head: Optional[Node]) -> Optional[Node]:
        # go through linked list
        # for each node:
        # - create an identical node
        if not head:
            return

        node_map = {}

        curr = head
        while curr:
            node_map[curr] = Node(curr.val)
            curr = curr.next

        for old_node, new_node in node_map.items():
            new_node.val = old_node.val
            new_node.next = node_map[old_node.next]
            new_node.random = node_map[old_node.random]

        return node_map[head]

    def copyRandomListInterleave(self, head: Optional[Node]) -> Optional[Node]:
        if not head:
            return

        # 1st pass: create interleaving linked list
        curr = head
        while curr:
            curr.next = Node(curr.val, curr.next, None)
            curr = curr.next.next

        new_head = head.next
        # 2nd pass
        curr = head
        while curr and curr.next:
            next_node = curr.next.next
            if curr.random:
                curr.next.random = curr.random.next
            if next_node:
                curr.next.next = next_node.next
            curr.next = next_node
            curr = next_node

        return new_head


if __name__ == "__main__":
    # Test cases
    s = Solution()
    test_cases = [
        Node(2, Node(4, Node(6, Node(8)))),
        # Node(2, Node(4, Node(6, Node(8, Node(10, None))))),
        # Node(1, None),
    ]
    for test_case in test_cases:
        head = s.copyRandomListInterleave(test_case)
        print_linked_list(head)
        print()
