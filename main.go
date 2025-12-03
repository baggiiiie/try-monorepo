package main

import (
	"fmt"
	"net/http"
	"strings"
)

type App struct {
	urlMap urlMapping
}

type urlMapping = map[string]string

var myURLMap = urlMapping{
	"short-url-1": "this-is-a-very-long-url-1",
}

func getLongURL(shortURL string, urlMap urlMapping) (string, error) {
	if longURL, ok := urlMap[shortURL]; ok {
		return longURL, nil
	}
	err := fmt.Errorf("%s doesn't exist", shortURL)
	return "", err
}

func getURLHandler(w http.ResponseWriter, r *http.Request) {
	path := strings.Split(r.URL.Path, "/")
	if len(path) < 1 {
		w.WriteHeader(http.StatusBadRequest)
		return
	}
	shortURL := path[1]
	fmt.Println("short url is", shortURL)
	newURL, err := getLongURL(shortURL, myURLMap)
	if err != nil {
		w.WriteHeader(http.StatusBadRequest)
		return
	}
	location := fmt.Sprintf("http://localhost:3000/%s", newURL)
	w.Header().Set("Location", location)
	w.WriteHeader(http.StatusMovedPermanently)
	w.Write([]byte("test"))
}

func main() {
	// NOTE: to build a url shortener, we need:
	// - a http server that listens to shortened url
	// - a database (in memory or not) storing mapping of short-long url
	// - check mapping
	// - http server return long url and redirect code
	fmt.Println("my url shortener starts")
	http.HandleFunc("/", getURLHandler)
	_ = http.ListenAndServe("localhost:3000", nil)
	// app := App{
	// 	urlMap: myURLMap,
	// }
	// longURL, err := app.getLongURL("")
	// if err != nil {
	// 	fmt.Println("error getting url", err)
	// } else {
	// 	fmt.Println("long url is", longURL)
	// }
}
