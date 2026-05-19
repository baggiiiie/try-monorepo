.PHONY: simulator build install run server web web-dev test docker-build docker-run

SIMULATOR_DEVICE = iPhone 17 Pro
IOS_DIR = ios
SERVER_DIR = server
SCHEME = ExpenseTracker
BUNDLE_ID = com.ydai.ExpenseTracker
BUILD_TIMESTAMP ?= $(shell date -u +"%Y%m%d%H%M%S")
BUILD_GIT_HASH ?= $(shell git rev-parse --short HEAD 2>/dev/null || echo nogit)
APP_BUILD_VERSION ?= $(BUILD_TIMESTAMP)-$(BUILD_GIT_HASH)

# iOS targets
simulator:
	@open -a Simulator
	@xcrun simctl boot "$(SIMULATOR_DEVICE)" 2>/dev/null || true

build:
	@xcodebuild -project $(IOS_DIR)/ExpenseTracker.xcodeproj \
		-scheme $(SCHEME) \
		-sdk iphonesimulator \
		-destination 'platform=iOS Simulator,name=$(SIMULATOR_DEVICE)' \
		-derivedDataPath $(IOS_DIR)/.build/DerivedData \
		APP_BUILD_VERSION=$(APP_BUILD_VERSION) \
		-quiet \
		build

install: build simulator
	@xcrun simctl install booted \
		$$(find $(IOS_DIR)/.build/DerivedData -name "$(SCHEME).app" -path "*/Debug-iphonesimulator/*" | head -1)

run: install
	@xcrun simctl launch booted $(BUNDLE_ID) > /dev/null

# Server targets
server:
	@cd $(SERVER_DIR) && go build -o bin/expense ./cmd/expense/ && ./bin/expense

web:
	@if test -f $(SERVER_DIR)/web/package.json; then cd $(SERVER_DIR)/web && pnpm build; else test -f $(SERVER_DIR)/web/dist/index.html; fi

web-dev:
	@if test -f $(SERVER_DIR)/web/package.json; then cd $(SERVER_DIR)/web && pnpm dev; else echo "Static web client is in $(SERVER_DIR)/web/dist; run make server and open http://localhost:8080"; fi

# Docker targets
docker-build:
	@docker build -t expense-tracker $(SERVER_DIR)

docker-run: docker-build
	@docker run --rm -p 8080:8080 -v expense-data:/data expense-tracker

# Test targets
test:
	@cd tests && bash run_all.sh
