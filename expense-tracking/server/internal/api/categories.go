package api

import (
	"net/http"

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

func createCategory(categories CategoryService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req createCategoryRequest
		if err := readJSON(r, &req); err != nil {
			writeError(w, r, http.StatusBadRequest, "invalid request body")
			return
		}

		cat, err := categories.Create(r.Context(), service.CategoryInput{
			Name:   req.Name,
			Icon:   req.Icon,
			Budget: req.Budget,
		})
		if err != nil {
			writeError(w, r, http.StatusUnprocessableEntity, err.Error())
			return
		}

		writeJSON(w, http.StatusCreated, cat)
	}
}

func listCategories(categories CategoryService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		categories, err := categories.List(r.Context())
		if err != nil {
			writeError(w, r, http.StatusInternalServerError, err.Error())
			return
		}

		writeJSON(w, http.StatusOK, map[string]interface{}{
			"categories": categories,
			"count":      len(categories),
		})
	}
}

func updateCategory(categories CategoryService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := chi.URLParam(r, "id")

		var req updateCategoryRequest
		if err := readJSON(r, &req); err != nil {
			writeError(w, r, http.StatusBadRequest, "invalid request body")
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

		cat, err := categories.Update(r.Context(), id, input)
		if err != nil {
			if err.Error() == "category not found" {
				writeError(w, r, http.StatusNotFound, err.Error())
				return
			}
			writeError(w, r, http.StatusUnprocessableEntity, err.Error())
			return
		}

		writeJSON(w, http.StatusOK, cat)
	}
}

func deleteCategory(categories CategoryService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := chi.URLParam(r, "id")

		if err := categories.Delete(r.Context(), id); err != nil {
			writeError(w, r, http.StatusInternalServerError, err.Error())
			return
		}

		w.WriteHeader(http.StatusNoContent)
	}
}
