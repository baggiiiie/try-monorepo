package tools

import (
	"fmt"
	"strings"
	"sync"
)

type TodoItem struct {
	ID   int
	Task string
	Done bool
}

type TodoTool struct {
	mu    sync.Mutex
	items []TodoItem
	next  int
}

func (t *TodoTool) Name() string { return "todo" }

func (t *TodoTool) Description() string {
	return "Manage a TODO list to track tasks. Actions: add, complete, list, remove."
}

func (t *TodoTool) Schema() map[string]any {
	return BuildSchema([]Param{
		{Name: "action", Type: "string", Description: "One of: add, complete, list, remove", Required: true},
		{Name: "task", Type: "string", Description: "Task description (required for add)", Required: false},
		{Name: "id", Type: "integer", Description: "Task ID (required for complete and remove)", Required: false},
	})
}

func (t *TodoTool) Execute(args map[string]any) string {
	action, _ := args["action"].(string)

	t.mu.Lock()
	defer t.mu.Unlock()

	switch action {
	case "add":
		task, _ := args["task"].(string)
		if task == "" {
			return "error: task is required for add"
		}
		t.next++
		t.items = append(t.items, TodoItem{ID: t.next, Task: task})
		return fmt.Sprintf("Added task #%d. %s", t.next, t.formatList())

	case "complete":
		id := toInt(args["id"])
		for i := range t.items {
			if t.items[i].ID == id {
				t.items[i].Done = true
				return fmt.Sprintf("Completed task #%d. %s", id, t.formatList())
			}
		}
		return fmt.Sprintf("error: task #%d not found", id)

	case "remove":
		id := toInt(args["id"])
		for i := range t.items {
			if t.items[i].ID == id {
				t.items = append(t.items[:i], t.items[i+1:]...)
				return fmt.Sprintf("Removed task #%d. %s", id, t.formatList())
			}
		}
		return fmt.Sprintf("error: task #%d not found", id)

	case "list":
		if len(t.items) == 0 {
			return "No tasks."
		}
		return t.formatList()

	default:
		return "error: unknown action: " + action
	}
}

func (t *TodoTool) formatList() string {
	if len(t.items) == 0 {
		return "No tasks remaining."
	}
	var b strings.Builder
	for _, item := range t.items {
		check := "[ ]"
		if item.Done {
			check = "[x]"
		}
		fmt.Fprintf(&b, "#%d %s %s\n", item.ID, check, item.Task)
	}
	return b.String()
}

func toInt(v any) int {
	switch n := v.(type) {
	case float64:
		return int(n)
	case int:
		return n
	default:
		return 0
	}
}
