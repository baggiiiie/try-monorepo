package main

import (
	"crypto/sha1"
	"encoding/base64"
	"fmt"
	"io"
	"net/http"
	"strings"
)

type App struct {
	urlMap    urlMapping
	URLLength int
}

type urlMapping = map[string]string

var myURLMap = urlMapping{
	"short-url-1": "this-is-a-very-long-url-1",
}

func (app App) getLongURL(shortURL string) (string, error) {
	if longURL, ok := app.urlMap[shortURL]; ok {
		return longURL, nil
	}
	err := fmt.Errorf("%s doesn't exist", shortURL)
	return "", err
}

func (app App) generateShortURL(longURL string) string {
	hash := sha1.Sum([]byte(longURL))
	shortURL := base64.RawURLEncoding.EncodeToString(hash[:])
	return shortURL[:app.URLLength]
}

func (app App) getURLHandler(w http.ResponseWriter, r *http.Request) {
	path := strings.Split(r.URL.Path, "/")
	if len(path) < 1 {
		w.WriteHeader(http.StatusBadRequest)
		return
	}
	shortURL := path[1]
	fmt.Println("requested short url is", shortURL)
	longURL, err := app.getLongURL(shortURL)
	if err != nil {
		w.WriteHeader(http.StatusBadRequest)
		return
	}
	location := fmt.Sprintf("http://localhost:3000/%s", longURL)
	w.Header().Set("Location", location)
	w.WriteHeader(http.StatusMovedPermanently)
	if _, err = fmt.Fprintf(w, "%s is moved permanently to %s", shortURL, longURL); err != nil {
		fmt.Println("err writing to response writer:", err)
	}
	fmt.Printf("%s is moved permanently to %s", shortURL, longURL)
}

func (app App) generateURLHandler(w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(r.Body)
	if err != nil {
		http.Error(w, "cannot read body", http.StatusBadRequest)
		return
	}
	defer r.Body.Close()

	longURL := string(body)
	shortURL := app.generateShortURL(longURL)
	app.urlMap[shortURL] = longURL
	msg := fmt.Sprintf("%s is generated for %s", shortURL, longURL)
	fmt.Println(msg)
	w.Write([]byte(msg))
}

func main() {
	// NOTE: to build a url shortener, we need:
	// - a http server that listens to shortened url
	// - a database (in memory or not) storing mapping of short-long url
	// - check mapping
	// - http server return long url and redirect code
	fmt.Println("my url shortener starts")
	app := App{
		urlMap:    myURLMap,
		URLLength: 16,
	}
	mux := http.NewServeMux()
	mux.HandleFunc("/", app.getURLHandler)
	mux.HandleFunc("/url", app.generateURLHandler)

	server := &http.Server{
		Addr:    ":3000",
		Handler: mux,
	}
	_ = server.ListenAndServe()
}
