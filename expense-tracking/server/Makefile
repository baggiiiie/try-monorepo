.PHONY: build generate test migrate migrate-status

DB ?= expense.db
GOOSE ?= $(HOME)/go/bin/goose
GOOSE_DRIVER ?= sqlite3
GOOSE_DBSTRING ?= $(DB)
GOOSE_MIGRATION_DIR ?= db/migrations

build:
	go build -o bin/expense ./cmd/expense/

generate:
	sqlc generate

migrate:
	$(GOOSE) -dir $(GOOSE_MIGRATION_DIR) $(GOOSE_DRIVER) $(GOOSE_DBSTRING) up

migrate-status:
	$(GOOSE) -dir $(GOOSE_MIGRATION_DIR) $(GOOSE_DRIVER) $(GOOSE_DBSTRING) status

test:
	cd ../tests && bash run_all.sh
