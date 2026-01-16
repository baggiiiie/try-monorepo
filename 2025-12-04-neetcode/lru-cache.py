def print_linked_list(head):
    length = 0
    while head and length < 20:
        print(head, end=" <-> ")
        head = head.next
        length += 1
    print("[null]")


# Definition for singly-linked list.
class ListNode:
    def __init__(self, key=0, value=0, next=None, prev=None):
        self.key = key
        self.value = value
        self.next = next
        self.prev = prev

    def __repr__(self) -> str:
        return f"<{self.key}: {self.value}>"


class LRUCache:
    def __init__(self, capacity: int):
        # init a linked list with length n
        if not capacity > 0:
            return
        self.cap = capacity
        # lru_head is Least Rencently Used
        self.lru_head, self.mru_tail = ListNode(0, 0), ListNode(0, 0)
        self.lru_head.next = self.mru_tail
        self.mru_tail.prev = self.lru_head
        self.hash_map = {}

    def remove_node(self, node: ListNode):
        # remove node from linked list
        prev_node, next_node = node.prev, node.next
        assert prev_node is not None and next_node is not None
        prev_node.next = next_node
        next_node.prev = prev_node
        # remove node from hash map
        del self.hash_map[node.key]

    def insert_node(self, node: ListNode):
        # when a node is inserted, it's always the *most recently used*
        # hence, it's inserted to the mru_tail
        prev_node = self.mru_tail.prev
        assert prev_node is not None
        prev_node.next = node
        node.prev = prev_node
        node.next = self.mru_tail
        self.mru_tail.prev = node
        self.hash_map[node.key] = node

    def get(self, key: int) -> int:
        # `get` operation will make the node become most recently used
        # hence, need to move node with key to mru_tail
        if key in self.hash_map:
            node = self.hash_map[key]
            self.remove_node(node)
            self.insert_node(node)
            print(f"get {key} is {node.value}")
            return node.value
        return -1

    def put(self, key: int, value: int) -> None:
        print(f"put in {key}:{value}")
        # if key exist in hash map: update value, move node to mru_tail
        # else: remove lru_head from list and hash map, add node to mru_tail
        # and hash map
        if key in self.hash_map:
            node = self.hash_map[key]
            node.value = value
            self.remove_node(node)
            self.insert_node(node)
        else:
            node = ListNode(key, value)
            self.hash_map[key] = node
            self.insert_node(node)
        if len(self.hash_map) > self.cap:
            assert self.lru_head.next is not None
            self.remove_node(self.lru_head.next)


if __name__ == "__main__":
    cache = LRUCache(3)
    print_linked_list(cache.lru_head)
    print("get 1 is:", cache.get(1))
    cache.put(1, 10)
    print_linked_list(cache.lru_head)
    cache.get(1)
    print_linked_list(cache.lru_head)
    cache.put(2, 20)
    cache.get(2)
    print_linked_list(cache.lru_head)
    cache.put(2, 10)
    cache.get(2)
    print_linked_list(cache.lru_head)
    cache.put(3, 30)
    cache.get(3)
    print_linked_list(cache.lru_head)
    print(cache.hash_map)
