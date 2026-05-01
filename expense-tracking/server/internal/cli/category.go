package cli

import (
	"context"
	"fmt"
	"math"

	"expense-tracker/internal/service"

	"github.com/spf13/cobra"
)

var categoryCmd = &cobra.Command{
	Use:   "category",
	Short: "Manage categories",
}

var categoryAddCmd = &cobra.Command{
	Use:   "add",
	Short: "Add a new category",
	RunE: func(cmd *cobra.Command, args []string) error {
		name, _ := cmd.Flags().GetString("name")
		icon, _ := cmd.Flags().GetString("icon")

		input := service.CategoryInput{
			Name: name,
			Icon: icon,
		}

		if cmd.Flags().Changed("budget") {
			budgetFloat, _ := cmd.Flags().GetFloat64("budget")
			budgetCents := int64(math.Round(budgetFloat * 100))
			input.Budget = &budgetCents
		}

		cat, err := application.CategoryService.Create(context.Background(), input)
		if err != nil {
			return err
		}

		fmt.Printf("Added category %s: %s %s\n", cat.ID, cat.Icon, cat.Name)
		return nil
	},
}

var categoryListCmd = &cobra.Command{
	Use:   "list",
	Short: "List categories",
	RunE: func(cmd *cobra.Command, args []string) error {
		jsonOutput, _ := cmd.Flags().GetBool("json")

		categories, err := application.CategoryService.List(context.Background())
		if err != nil {
			return err
		}

		if jsonOutput {
			result := map[string]any{
				"categories": categories,
			}
			return writeJson(result)
		}

		if len(categories) == 0 {
			fmt.Println("No categories found.")
			return nil
		}

		for _, c := range categories {
			budgetStr := ""
			if c.Budget != nil {
				budgetStr = fmt.Sprintf(" (budget: %s)", formatAmount(*c.Budget, application.Preferences.Currency))
			}
			fmt.Printf("%s  %s %s%s\n", c.ID, c.Icon, c.Name, budgetStr)
		}
		return nil
	},
}

var categoryEditCmd = &cobra.Command{
	Use:   "edit [id]",
	Short: "Edit a category",
	Args:  cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		id := args[0]
		input := service.CategoryInput{}

		if cmd.Flags().Changed("name") {
			input.Name, _ = cmd.Flags().GetString("name")
		}
		if cmd.Flags().Changed("icon") {
			input.Icon, _ = cmd.Flags().GetString("icon")
		}
		if cmd.Flags().Changed("budget") {
			budgetFloat, _ := cmd.Flags().GetFloat64("budget")
			budgetCents := int64(math.Round(budgetFloat * 100))
			input.Budget = &budgetCents
		}

		cat, err := application.CategoryService.Update(context.Background(), id, input)
		if err != nil {
			return err
		}

		fmt.Printf("Updated category %s: %s %s\n", cat.ID, cat.Icon, cat.Name)
		return nil
	},
}

var categoryDeleteCmd = &cobra.Command{
	Use:   "delete [id]",
	Short: "Delete a category (soft delete)",
	Args:  cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		if err := application.CategoryService.Delete(context.Background(), args[0]); err != nil {
			return err
		}
		fmt.Printf("Deleted category %s\n", args[0])
		return nil
	},
}

func init() {
	categoryAddCmd.Flags().String("name", "", "category name")
	categoryAddCmd.Flags().String("icon", "", "category icon (emoji)")
	categoryAddCmd.Flags().Float64("budget", 0, "monthly budget amount")
	categoryAddCmd.MarkFlagRequired("name")

	categoryListCmd.Flags().Bool("json", false, "output as JSON")

	categoryEditCmd.Flags().String("name", "", "category name")
	categoryEditCmd.Flags().String("icon", "", "category icon (emoji)")
	categoryEditCmd.Flags().Float64("budget", 0, "monthly budget amount")

	categoryCmd.AddCommand(categoryAddCmd)
	categoryCmd.AddCommand(categoryListCmd)
	categoryCmd.AddCommand(categoryEditCmd)
	categoryCmd.AddCommand(categoryDeleteCmd)

	rootCmd.AddCommand(categoryCmd)
}
