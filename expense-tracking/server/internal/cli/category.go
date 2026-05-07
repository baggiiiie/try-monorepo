package cli

import (
	"context"
	"fmt"
	"math"

	"expense-tracker/internal/service"

	"github.com/spf13/cobra"
)

func newCategoryCmd(categories categoryServiceProvider, prefs preferencesServiceProvider) *cobra.Command {
	categoryCmd := &cobra.Command{
		Use:   "category",
		Short: "Manage categories",
	}

	categoryAddCmd := &cobra.Command{
		Use:   "add",
		Short: "Add a new category",
		RunE: func(cmd *cobra.Command, args []string) error {
			categoryService := categories()
			if categoryService == nil {
				return fmt.Errorf("category service is not initialized")
			}

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

			cat, err := categoryService.Create(context.Background(), input)
			if err != nil {
				return err
			}

			fmt.Printf("Added category %s: %s %s\n", cat.ID, cat.Icon, cat.Name)
			return nil
		},
	}

	categoryListCmd := &cobra.Command{
		Use:   "list",
		Short: "List categories",
		RunE: func(cmd *cobra.Command, args []string) error {
			jsonOutput, _ := cmd.Flags().GetBool("json")

			categoryService := categories()
			if categoryService == nil {
				return fmt.Errorf("category service is not initialized")
			}
			prefService := prefs()
			if prefService == nil {
				return fmt.Errorf("cli runtime is not initialized")
			}
			preferences := prefService.GetPreferences()

			categories, err := categoryService.List(context.Background())
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
					budgetStr = fmt.Sprintf(" (budget: %s)", formatAmount(*c.Budget, preferences.Currency))
				}
				fmt.Printf("%s  %s %s%s\n", c.ID, c.Icon, c.Name, budgetStr)
			}
			return nil
		},
	}

	categoryEditCmd := &cobra.Command{
		Use:   "edit [id]",
		Short: "Edit a category",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			categoryService := categories()
			if categoryService == nil {
				return fmt.Errorf("category service is not initialized")
			}

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

			cat, err := categoryService.Update(context.Background(), id, input)
			if err != nil {
				return err
			}

			fmt.Printf("Updated category %s: %s %s\n", cat.ID, cat.Icon, cat.Name)
			return nil
		},
	}

	categoryDeleteCmd := &cobra.Command{
		Use:   "delete [id]",
		Short: "Delete a category (soft delete)",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			categoryService := categories()
			if categoryService == nil {
				return fmt.Errorf("category service is not initialized")
			}
			if err := categoryService.Delete(context.Background(), args[0]); err != nil {
				return err
			}
			fmt.Printf("Deleted category %s\n", args[0])
			return nil
		},
	}

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

	return categoryCmd
}
