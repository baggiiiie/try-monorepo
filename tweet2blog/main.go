package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"os"
)

func main() {
	// Define flags
	outputFile := flag.String("o", "", "Output HTML file (default: stdout)")
	customTitle := flag.String("t", "", "Custom thread title")
	jsonOutput := flag.Bool("json", false, "Output raw JSON data")
	embedImages := flag.Bool("embed-images", false, "Embed images as data URLs")
	markdownOutput := flag.Bool("md", false, "Output as markdown instead of HTML")
	verbose := flag.Bool("v", false, "Verbose output")

	flag.Usage = func() {
		fmt.Fprintf(os.Stderr, `tweet2blog - Convert Twitter/X threads to blog-style HTML

Usage:
  tweet2blog <URL> [options]

Arguments:
  <URL>  URL of any tweet in the thread (e.g., https://x.com/username/status/1234567890)

Options:
`)
		flag.PrintDefaults()
		fmt.Fprintf(os.Stderr, `
Examples:
  tweet2blog https://x.com/patio11/status/2011884933258887572
  tweet2blog -o thread.html https://x.com/username/status/123456789
  tweet2blog --md https://x.com/username/status/123456789 > thread.md
  tweet2blog --json https://x.com/username/status/123456789
`)
	}

	flag.Parse()

	args := flag.Args()
	if len(args) == 0 {
		flag.Usage()
		os.Exit(1)
	}

	tweetURL := args[0]
	ctx := context.Background()

	// Create logger
	logger := NewLogger(*verbose)

	// Initialize fetcher
	fetcher := NewTwitterFetcher(logger)

	// Fetch thread
	logger.Info("Fetching thread from URL: %s", tweetURL)
	thread, err := fetcher.FetchThread(ctx, tweetURL)
	if err != nil {
		log.Fatalf("Failed to fetch thread: %v", err)
	}

	if *customTitle != "" {
		thread.Title = *customTitle
	}

	logger.Info("Found %d tweets in thread", len(thread.Tweets))

	// Output based on flags
	var output string
	if *jsonOutput {
		output, err = RenderJSON(thread)
		if err != nil {
			log.Fatalf("Failed to render JSON: %v", err)
		}
	} else if *markdownOutput {
		output, err = RenderMarkdown(thread)
		if err != nil {
			log.Fatalf("Failed to render markdown: %v", err)
		}
	} else {
		output, err = RenderHTML(thread, *embedImages)
		if err != nil {
			log.Fatalf("Failed to render HTML: %v", err)
		}
	}

	// Write output
	if *outputFile != "" {
		if err := os.WriteFile(*outputFile, []byte(output), 0644); err != nil {
			log.Fatalf("Failed to write output file: %v", err)
		}
		logger.Info("Output written to: %s", *outputFile)
	} else {
		fmt.Print(output)
	}
}
