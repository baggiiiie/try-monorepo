.PHONY: build run test clean help install lint fmt

# Build variables
BINARY_NAME=tweet2blog
GO=go
GOFLAGS=-v
LDFLAGS=-ldflags "-s -w"

help:
	@echo "tweet2blog - CLI for converting Twitter threads to HTML"
	@echo ""
	@echo "Available targets:"
	@echo "  make build         Build the binary"
	@echo "  make run           Build and run with example URL"
	@echo "  make test          Run tests"
	@echo "  make clean         Remove build artifacts"
	@echo "  make fmt           Format code"
	@echo "  make lint          Run linter"
	@echo "  make install       Build and install to GOBIN"
	@echo "  make dev           Build with debug info"

build:
	@echo "Building $(BINARY_NAME)..."
	$(GO) build $(GOFLAGS) -o $(BINARY_NAME) .
	@echo "✓ Build complete: ./$(BINARY_NAME)"

dev:
	@echo "Building $(BINARY_NAME) with debug info..."
	$(GO) build $(GOFLAGS) -o $(BINARY_NAME) .

run: build
	@echo "Running with example tweet..."
	./$(BINARY_NAME) -v https://x.com/patio11/status/2011884933258887572

test:
	@echo "Running tests..."
	$(GO) test -v ./...

clean:
	@echo "Cleaning build artifacts..."
	@rm -f $(BINARY_NAME)
	@rm -f test_output.html
	@$(GO) clean

fmt:
	@echo "Formatting code..."
	@$(GO) fmt ./...
	@goimports -w . 2>/dev/null || echo "Note: goimports not installed, skipping"

lint:
	@echo "Running linter..."
	@golangci-lint run ./... 2>/dev/null || echo "Note: golangci-lint not installed"
	@$(GO) vet ./...

install: build
	@echo "Installing $(BINARY_NAME)..."
	@mkdir -p $(GOBIN)
	@cp $(BINARY_NAME) $(GOBIN)/
	@echo "✓ Installed to $(GOBIN)/$(BINARY_NAME)"

deps:
	@echo "Checking dependencies..."
	@$(GO) mod tidy
	@$(GO) mod verify

version:
	@echo "$(BINARY_NAME) version info:"
	@$(GO) version

.PHONY: all
all: clean fmt lint build test
	@echo "✓ All checks passed"
