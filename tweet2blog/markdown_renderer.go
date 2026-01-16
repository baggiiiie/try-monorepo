package main

import (
	"fmt"
	"strings"
)

type MarkdownRenderer struct{}

func NewMarkdownRenderer() *MarkdownRenderer {
	return &MarkdownRenderer{}
}

func (r *MarkdownRenderer) Render(thread *Thread, customTitle string) string {
	var sb strings.Builder

	// Title
	title := customTitle
	if title == "" {
		if len(thread.Tweets) > 0 {
			firstTweetText := thread.Tweets[0].Text
			if len(firstTweetText) > 80 {
				title = firstTweetText[:80] + "..."
			} else {
				title = firstTweetText
			}
		}
		if title == "" {
			title = fmt.Sprintf("Thread by @%s", thread.Author.Username)
		}
	}
	sb.WriteString("# ")
	sb.WriteString(title)
	sb.WriteString("\n\n")

	// Author header
	sb.WriteString(fmt.Sprintf("**%s**", thread.Author.Name))
	if thread.Author.Verified {
		sb.WriteString(" ✓")
	}
	sb.WriteString(fmt.Sprintf(" (@%s)\n\n", thread.Author.Username))

	// Thread tweets
	for i, tweet := range thread.Tweets {
		sb.WriteString(fmt.Sprintf("## Tweet %d/%d\n\n", i+1, len(thread.Tweets)))
		
		// Tweet text
		sb.WriteString(tweet.Text)
		sb.WriteString("\n\n")

		// Media
		if len(tweet.Media) > 0 {
			for _, media := range tweet.Media {
				sb.WriteString(fmt.Sprintf("![%s](%s)\n\n", media.AltText, media.URL))
			}
		}

		// Quoted tweet
		if tweet.QuotedTweet != nil {
			sb.WriteString("> ")
			sb.WriteString(fmt.Sprintf("**%s (@%s)**: ", 
				tweet.QuotedTweet.Author.Name, 
				tweet.QuotedTweet.Author.Username))
			sb.WriteString(tweet.QuotedTweet.Text)
			sb.WriteString("\n\n")
		}

		// Metadata
		dateStr := tweet.CreatedAt.Format("January 2, 2006 at 3:04 PM")
		sb.WriteString(fmt.Sprintf("_%s_ - [View on X](%s)\n\n", 
			dateStr, 
			tweet.URL))
		sb.WriteString("---\n\n")
	}

	// Footer
	sb.WriteString("*Converted by [tweet2blog](https://github.com/yourusername/tweet2blog)*\n")

	return sb.String()
}
