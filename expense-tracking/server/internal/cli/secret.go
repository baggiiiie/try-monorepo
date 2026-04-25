package cli

import (
	"fmt"

	"expense-tracker/internal/auth"

	"github.com/spf13/cobra"
)

var secretCmd = &cobra.Command{
	Use:   "secret",
	Short: "Manage the sync secret shared with the iOS client",
}

var secretShowCmd = &cobra.Command{
	Use:   "show",
	Short: "Print the current sync secret",
	RunE: func(cmd *cobra.Command, args []string) error {
		s, generated, err := auth.LoadOrCreate(secretPath)
		if err != nil {
			return err
		}
		if generated {
			fmt.Fprintln(cmd.OutOrStdout(), "(generated a new secret because none existed)")
		}
		fmt.Fprintln(cmd.OutOrStdout(), s)
		return nil
	},
}

var secretRotateCmd = &cobra.Command{
	Use:   "rotate",
	Short: "Generate a new sync secret, replacing the existing one",
	RunE: func(cmd *cobra.Command, args []string) error {
		s, err := auth.Rotate(secretPath)
		if err != nil {
			return err
		}
		fmt.Fprintln(cmd.OutOrStdout(), "New sync secret (paste into the iOS app Settings):")
		fmt.Fprintln(cmd.OutOrStdout(), "")
		fmt.Fprintln(cmd.OutOrStdout(), "  "+s)
		fmt.Fprintln(cmd.OutOrStdout(), "")
		fmt.Fprintln(cmd.OutOrStdout(), "The previous secret is no longer valid; restart `expense serve` to apply.")
		return nil
	},
}

func init() {
	secretCmd.AddCommand(secretShowCmd, secretRotateCmd)
	rootCmd.AddCommand(secretCmd)
}
