.PHONY: build generate test

build:
	go build -o bin/expense ./cmd/expense/

generate:
	sqlc generate

test:
	cd ../tests && bash run_all.sh
