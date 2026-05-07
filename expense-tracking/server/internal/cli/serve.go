package cli

import (
	"fmt"
	"log/slog"
	"net/http"
	"os"

	"expense-tracker/internal/api"
	"expense-tracker/internal/app"
	"expense-tracker/internal/auth"

	"github.com/spf13/cobra"
)

func newServeCmd(paths pathProvider) *cobra.Command {
	serveCmd := &cobra.Command{
		Use:   "serve",
		Short: "Start the HTTP API server",
		RunE: func(cmd *cobra.Command, args []string) error {
			port, _ := cmd.Flags().GetInt("port")
			slog.SetDefault(slog.New(newServerLogHandler(os.Stdout)))

			dbPath, configPath, secretPath := paths()
			a, err := app.Open(dbPath, configPath)
			if err != nil {
				return fmt.Errorf("initializing app: %w", err)
			}
			defer a.Close()

			secret, generated, err := auth.LoadOrCreate(secretPath)
			if err != nil {
				return fmt.Errorf("loading sync secret: %w", err)
			}
			if generated {
				fmt.Fprintln(cmd.OutOrStdout(), "==============================================================")
				fmt.Fprintln(cmd.OutOrStdout(), "Generated a new sync secret. Paste it into the iOS app Settings:")
				fmt.Fprintln(cmd.OutOrStdout(), "")
				fmt.Fprintln(cmd.OutOrStdout(), "  "+secret)
				fmt.Fprintln(cmd.OutOrStdout(), "")
				fmt.Fprintln(cmd.OutOrStdout(), "Stored at "+secretPath+" (mode 0600).")
				fmt.Fprintln(cmd.OutOrStdout(), "Re-run `expense secret show` to print it again.")
				fmt.Fprintln(cmd.OutOrStdout(), "==============================================================")
			}

			services := a.Services()
			router := api.NewRouter(api.RouterServices{
				Expenses:    services.Expenses,
				Categories:  services.Categories,
				Sync:        services.Sync,
				Preferences: a,
			}, secret)

			addr := fmt.Sprintf(":%d", port)
			slog.Info("server.start", slog.String("addr", addr))
			return http.ListenAndServe(addr, router)
		},
	}

	serveCmd.Flags().Int("port", 8080, "port to listen on")
	return serveCmd
}
