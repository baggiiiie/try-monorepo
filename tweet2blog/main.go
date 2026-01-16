package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"os"

	"github.com/fatih/color"
)

func main() {
	var (
		outputFile  = flag.String("o", "", "Output file (default: stdout or auto-generated name)")
		jsonOutput  = flag.Bool("json", false, "Output raw JSON instead of HTML")
		customTitle = flag.String("t", "", "Custom title for the blog post")
		embedImages = flag.Bool("embed-images", false, "Download and embed images as data URLs (for standalone HTML)")
		format      = flag.String("format", "html", "Output format: html or markdown")
	)
	flag.Parse()

	if flag.NArg() == 0 {
		color.Red("Error: No tweet URL provided")
		fmt.Println("\nUsage: tweet2blog [options] <tweet-url>")
		fmt.Println("\nOptions:")
		flag.PrintDefaults()
		fmt.Println("\nExample:")
		fmt.Println("  tweet2blog https://x.com/username/status/1234567890123456789")
		os.Exit(1)
	}

	tweetURL := flag.Arg(0)
	ctx := context.Background()

	// Create client
	client := NewTwitterClient()

	// Fetch thread
	color.Cyan("Fetching thread from: %s", tweetURL)
	thread, err := client.FetchThread(ctx, tweetURL)
	if err != nil {
		color.Red("Error fetching thread: %v", err)
		os.Exit(1)
	}

	if len(thread.Tweets) == 0 {
		color.Red("Error: No tweets found in thread")
		os.Exit(1)
	}

	color.Green("✓ Found %d tweet(s) in thread", len(thread.Tweets))

	// JSON output
	if *jsonOutput {
		encoder := json.NewEncoder(os.Stdout)
		encoder.SetIndent("", "  ")
		if err := encoder.Encode(thread); err != nil {
			color.Red("Error encoding JSON: %v", err)
			os.Exit(1)
		}
		return
	}

	// Generate output
	var output string
	if *format == "markdown" {
		renderer := NewMarkdownRenderer()
		output = renderer.Render(thread, *customTitle)
	} else {
		renderer := NewHTMLRenderer()
		renderer.EmbedImages = *embedImages
		output = renderer.Render(thread, *customTitle)
	}

	// Write output
	if *outputFile != "" {
		if err := os.WriteFile(*outputFile, []byte(output), 0644); err != nil {
			color.Red("Error writing file: %v", err)
			os.Exit(1)
		}
		color.Green("✓ Written to %s", *outputFile)
	} else {
		fmt.Print(output)
	}
}
