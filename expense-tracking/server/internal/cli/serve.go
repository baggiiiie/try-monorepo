package cli

import (
	"fmt"
	"log/slog"
	"net/http"
	"os"

	"expense-tracker/internal/api"
	"expense-tracker/internal/app"

	"github.com/spf13/cobra"
)

var serveCmd = &cobra.Command{
	Use:   "serve",
	Short: "Start the HTTP API server",
	RunE: func(cmd *cobra.Command, args []string) error {
		port, _ := cmd.Flags().GetInt("port")
		slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stdout, nil)))

		a, err := app.Open(dbPath, configPath)
		if err != nil {
			return fmt.Errorf("initializing app: %w", err)
		}
		defer a.Close()

		router := api.NewRouter(a)

		addr := fmt.Sprintf(":%d", port)
		slog.Info("server.start", slog.String("addr", addr))
		return http.ListenAndServe(addr, router)
	},
}

func init() {
	serveCmd.Flags().Int("port", 8080, "port to listen on")
	rootCmd.AddCommand(serveCmd)
}
