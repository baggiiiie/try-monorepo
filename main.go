package main

import (
	"fmt"
	"log"
	"net/http"
)

func homeHandler(w http.ResponseWriter, r *http.Request) {
	msg := "welcome to my url shortener"
	byteNum, err := fmt.Fprintf(w, "%s\n", msg)
	if err != nil {
		log.Println("writing failed")
	}
	log.Printf("%d number of bytes written", byteNum)
}

func main() {
	// NOTE: to build a url shortener, we need:
	// - a http server that listens to shortened url
	// - a database (in memory or not) storing mapping of short-long url
	// - check mapping
	// - http server return long url and redirect code
	fmt.Println("my url shortener starts")
	http.HandleFunc("/", homeHandler)
	_ = http.ListenAndServe("localhost:3000", nil)
}
