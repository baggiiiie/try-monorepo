package main

import (
	"fmt"
	"log"
	"net/http"
)

type App struct {
	urlMap urlMapping
}

type urlMapping = map[string]string

var myURLMap = urlMapping{
	"short-url-1": "this-is-a-very-long-url-1",
}

func (app *App) getLongURL(shortURL string) (string, error) {
	if longURL, ok := app.urlMap[shortURL]; ok {
		return longURL, nil
	}
	err := fmt.Errorf("%s doesn't exist", shortURL)
	return "", err
}

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
	app := App{
		urlMap: myURLMap,
	}
	longURL, err := app.getLongURL("")
	if err != nil {
		fmt.Println("error getting url", err)
	} else {
		fmt.Println("long url is", longURL)
	}
}
