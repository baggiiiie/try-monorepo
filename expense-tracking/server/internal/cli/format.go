package cli

import (
	"fmt"
	"time"
)

func formatAmount(cents int64, currency string) string {
	return fmt.Sprintf("%s%.2f", currencySymbol(currency), float64(cents)/100)
}

func formatDate(unixTs int64, loc *time.Location) string {
	return time.Unix(unixTs, 0).In(loc).Format("2006-01-02")
}

func currencySymbol(code string) string {
	switch code {
	case "USD":
		return "$"
	case "SGD":
		return "S$"
	case "EUR":
		return "€"
	case "GBP":
		return "£"
	case "CAD":
		return "C$"
	default:
		return code + " "
	}
}
