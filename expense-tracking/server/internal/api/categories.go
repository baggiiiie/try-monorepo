package api

import (
	"net/http"

	"expense-tracker/internal/app"
	"expense-tracker/internal/service"

	"github.com/go-chi/chi/v5"
)

type createCategoryRequest struct {
	Name   string `json:"name"`
	Icon   string `json:"icon"`
	Budget *int64 `json:"budget,omitempty"`
}

type updateCategoryRequest struct {
	Name   *string `json:"name"`
	Icon   *string `json:"icon"`
	Budget *int64  `json:"budget,omitempty"`
}

func createCategory(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req createCategoryRequest
		if err := readJSON(r, &req); err != nil {
			writeError(w, http.StatusBadRequest, "invalid request body")
			return
		}

		cat, err := a.CategoryService.Create(r.Context(), service.CategoryInput{
			Name:   req.Name,
			Icon:   req.Icon,
			Budget: req.Budget,
		})
		if err != nil {
			writeError(w, http.StatusUnprocessableEntity, err.Error())
			return
		}

		writeJSON(w, http.StatusCreated, cat)
	}
}

func listCategories(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		categories, err := a.CategoryService.List(r.Context())
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}

		writeJSON(w, http.StatusOK, map[string]interface{}{
			"categories": categories,
			"count":      len(categories),
		})
	}
}

func updateCategory(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := chi.URLParam(r, "id")

		var req updateCategoryRequest
		if err := readJSON(r, &req); err != nil {
			writeError(w, http.StatusBadRequest, "invalid request body")
			return
		}

		input := service.CategoryInput{}
		if req.Name != nil {
			input.Name = *req.Name
		}
		if req.Icon != nil {
			input.Icon = *req.Icon
		}
		if req.Budget != nil {
			input.Budget = req.Budget
		}

		cat, err := a.CategoryService.Update(r.Context(), id, input)
		if err != nil {
			if err.Error() == "category not found" {
				writeError(w, http.StatusNotFound, err.Error())
				return
			}
			writeError(w, http.StatusUnprocessableEntity, err.Error())
			return
		}

		writeJSON(w, http.StatusOK, cat)
	}
}

func deleteCategory(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := chi.URLParam(r, "id")

		if err := a.CategoryService.Delete(r.Context(), id); err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}

		w.WriteHeader(http.StatusNoContent)
	}
}
