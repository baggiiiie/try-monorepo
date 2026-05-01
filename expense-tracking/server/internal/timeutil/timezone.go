package timeutil

import "time"

// Singapore is a fixed-offset *time.Location for SGT (UTC+8). It is
// shared so callers can rely on pointer identity and avoid per-call
// allocations.
var Singapore = time.FixedZone("SGT", 8*60*60)

func LoadLocation(timezone string, fallback *time.Location) *time.Location {
	location, err := time.LoadLocation(timezone)
	if err != nil {
		return fallback
	}
	return location
}
