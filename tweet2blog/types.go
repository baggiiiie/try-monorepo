package main

import "time"

// Thread represents a complete Twitter thread
type Thread struct {
	RootTweetID string   `json:"root_tweet_id"`
	Tweets      []Tweet  `json:"tweets"`
	Author      Author   `json:"author"`
	CreatedAt   time.Time `json:"created_at"`
}

// Tweet represents a single tweet
type Tweet struct {
	ID          string        `json:"id"`
	Text        string        `json:"text"`
	Author      Author        `json:"author"`
	CreatedAt   time.Time     `json:"created_at"`
	Media       []Media       `json:"media"`
	QuotedTweet *Tweet        `json:"quoted_tweet,omitempty"`
	URL         string        `json:"url"`
	ReplyToID   string        `json:"reply_to_id,omitempty"`
	Poll        *Poll         `json:"poll,omitempty"`
}

// Author represents tweet author information
type Author struct {
	Name       string `json:"name"`
	Username   string `json:"username"`
	AvatarURL  string `json:"avatar_url"`
	Verified   bool   `json:"verified"`
	ID         string `json:"id"`
}

// Media represents media attached to a tweet
type Media struct {
	Type      string `json:"type"` // "photo", "video", "animated_gif"
	URL       string `json:"url"`
	Thumbnail string `json:"thumbnail,omitempty"`
	AltText   string `json:"alt_text,omitempty"`
}

// Poll represents a Twitter poll
type Poll struct {
	Options []PollOption `json:"options"`
	EndTime time.Time    `json:"end_time"`
}

// PollOption represents an option in a Twitter poll
type PollOption struct {
	Position int    `json:"position"`
	Label    string `json:"label"`
	Votes    int    `json:"votes,omitempty"`
}
