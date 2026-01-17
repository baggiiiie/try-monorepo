package main

import "time"

// Tweet represents a single tweet in the thread
type Tweet struct {
	ID          string
	Text        string
	Author      User
	CreatedAt   time.Time
	PublicMetrics struct {
		Likes    int
		Replies  int
		Retweets int
		Quotes   int
	}
	Attachments struct {
		Media []Media
		URLs  []string
	}
	QuotedTweet *Tweet
	ReplyTo     *Tweet
}

// User represents a Twitter user
type User struct {
	ID       string
	Name     string
	Username string
	Avatar   string
	Bio      string
	Followers int
	Verified bool
}

// Media represents media content in a tweet
type Media struct {
	Type     string // "photo", "video", "animated_gif"
	URL      string
	Preview  string // thumbnail or preview image
	AltText  string
}

// Thread represents a complete thread
type Thread struct {
	Title      string
	Tweets     []*Tweet
	Author     User
	TweetCount int
	CreatedAt  time.Time
	URL        string
}
