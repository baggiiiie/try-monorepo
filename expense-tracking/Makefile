.PHONY: simulator build install run server test docker-build docker-run

SIMULATOR_DEVICE = iPhone 17 Pro
IOS_DIR = ios
SERVER_DIR = server
SCHEME = ExpenseTracker
BUNDLE_ID = com.ydai.ExpenseTracker

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

# Docker targets
docker-build:
	@docker build -t expense-tracker $(SERVER_DIR)

docker-run: docker-build
	@docker run --rm -p 8080:8080 -v expense-data:/data expense-tracker

# Test targets
test:
	@cd tests && bash run_all.sh
