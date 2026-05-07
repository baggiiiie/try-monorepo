package cli

import (
	"context"
	"fmt"

	"github.com/spf13/cobra"
)

func newDeleteCmd(expenses expenseServiceProvider) *cobra.Command {
	return &cobra.Command{
		Use:   "delete [id]",
		Short: "Delete an expense (soft delete)",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			expenseService := expenses()
			if expenseService == nil {
				return fmt.Errorf("expense service is not initialized")
			}
			if err := expenseService.Delete(context.Background(), args[0]); err != nil {
				return err
			}
			fmt.Printf("Deleted expense %s\n", args[0])
			return nil
		},
	}
}
