package main

import (
	"encoding/json"
	"fmt"
)

type EventHooks struct {
	OnReasoningDelta func(delta string)
	OnReasoningDone  func()
	OnContentDelta   func(delta string)
	OnContentDone    func(fullContent string)
	OnToolCallDelta  func(index int, delta StreamToolCallDelta)
	OnToolCallReady  func(tc ToolCall)
	OnToolResult     func(name string, result string)
}

func DefaultHooks() *EventHooks {
	reasoningStarted := false
	contentStarted := false

	return &EventHooks{
		OnReasoningDelta: func(delta string) {
			if !reasoningStarted {
				fmt.Print("\n<REASONING>\n")
				reasoningStarted = true
			}
			fmt.Print(delta)
		},
		OnReasoningDone: func() {
			if reasoningStarted {
				fmt.Print("\n</REASONING>\n")
				reasoningStarted = false
			}
		},
		OnContentDelta: func(delta string) {
			if !contentStarted {
				fmt.Print("\nAgent> ")
				contentStarted = true
			}
			fmt.Print(delta)
		},
		OnContentDone: func(_ string) {
			if contentStarted {
				fmt.Println()
				contentStarted = false
			}
		},
		OnToolCallReady: func(tc ToolCall) {
			var args map[string]any
			if err := json.Unmarshal([]byte(tc.Function.Arguments), &args); err != nil {
				args = map[string]any{}
			}
			logMsg("TOOL CALL: "+tc.Function.Name, args)
		},
		OnToolResult: func(name string, result string) {
			logMsg("TOOL RESULT: "+name, result)
		},
	}
}
