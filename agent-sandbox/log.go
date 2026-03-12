package main

import (
	"encoding/json"
	"fmt"
)

func logMsg(label string, data any) {
	fmt.Printf("\n<%s>\n", label)
	switch v := data.(type) {
	case string:
		fmt.Println(v)
	default:
		b, err := json.MarshalIndent(v, "", "  ")
		if err != nil {
			fmt.Println(v)
		} else {
			fmt.Println(string(b))
		}
	}
	fmt.Printf("</%s>\n", label)
}
