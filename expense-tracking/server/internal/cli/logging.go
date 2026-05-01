package cli

import (
	"io"
	"log/slog"

	"expense-tracker/internal/timeutil"
)

func newServerLogHandler(w io.Writer) slog.Handler {
	return slog.NewJSONHandler(w, &slog.HandlerOptions{
		ReplaceAttr: func(groups []string, attr slog.Attr) slog.Attr {
			if attr.Key == slog.TimeKey && attr.Value.Kind() == slog.KindTime {
				return slog.Time(attr.Key, attr.Value.Time().In(timeutil.Singapore))
			}
			return attr
		},
	})
}
