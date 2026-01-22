#!/bin/bash
set -e

# ============================================================================
# ConfigLock Homebrew Tap Generator
# ============================================================================
#
# BEFORE RUNNING THIS SCRIPT:
#
# 1. Create a GitHub release with binaries attached:
#    gh release create v0.0.1 --generate-notes --title "configlock v0.0.1"
#    (GitHub Actions will build and attach binaries automatically)
#
# 2. Wait for GitHub Actions to complete and verify all 4 binaries exist:
#    - configlock-darwin-arm64
#    - configlock-darwin-amd64
#    - configlock-linux-arm64
#    - configlock-linux-amd64
#
# 3. Create a new GitHub repo named "homebrew-tap" under your account:
#    gh repo create baggiiiie/homebrew-tap --public --clone
#
# 4. Run this script with the version number:
#    ./homebrew.sh 0.0.1
#
# 5. After running, cd into homebrew-tap and push:
#    cd ../homebrew-tap
#    git add -A && git commit -m "Add configlock formula v0.0.1" && git push
#
# 6. Users can then install with:
#    brew tap baggiiiie/tap
#    brew install configlock
#
# ============================================================================

VERSION="${1:-0.0.1}"
GITHUB_USER="baggiiiie"
REPO_NAME="configlock"
TAP_DIR="../homebrew-tap"
BASE_URL="https://github.com/${GITHUB_USER}/${REPO_NAME}/releases/download/v${VERSION}"

echo "Homebrew Tap Generator"
echo "===================================="
echo "Version: ${VERSION}"
echo "Tap directory: ${TAP_DIR}"
echo ""

# Check if tap directory exists
if [ ! -d "${TAP_DIR}" ]; then
    echo "Error: ${TAP_DIR} does not exist."
    echo ""
    echo "Create it first with:"
    echo "  gh repo create ${GITHUB_USER}/homebrew-tap --public --clone --clone-path ${TAP_DIR}"
    echo ""
    echo "Or clone an existing repo:"
    echo "  git clone https://github.com/${GITHUB_USER}/homebrew-tap.git ${TAP_DIR}"
    exit 1
fi

# Create Formula directory
mkdir -p "${TAP_DIR}/Formula"

echo "Fetching SHA256 checksums..."
echo ""

fetch_sha() {
    local binary="$1"
    local url="${BASE_URL}/configlock-${binary}"
    
    HTTP_CODE=$(curl -sL -o /dev/null -w "%{http_code}" "${url}")
    if [ "${HTTP_CODE}" != "200" ]; then
        echo "NOT FOUND (HTTP ${HTTP_CODE})"
        echo ""
        echo "Error: Binary not found at ${url}"
        echo "Make sure the release exists and has all binaries attached."
        exit 1
    fi
    
    curl -sL "${url}" | shasum -a 256 | awk '{print $1}'
}

echo -n "  configlock-darwin-arm64: "
SHA_DARWIN_ARM64=$(fetch_sha "darwin-arm64")
echo "${SHA_DARWIN_ARM64}"

echo -n "  configlock-darwin-amd64: "
SHA_DARWIN_AMD64=$(fetch_sha "darwin-amd64")
echo "${SHA_DARWIN_AMD64}"

echo -n "  configlock-linux-arm64: "
SHA_LINUX_ARM64=$(fetch_sha "linux-arm64")
echo "${SHA_LINUX_ARM64}"

echo -n "  configlock-linux-amd64: "
SHA_LINUX_AMD64=$(fetch_sha "linux-amd64")
echo "${SHA_LINUX_AMD64}"

echo ""
echo "Generating Formula/configlock.rb..."

cat > "${TAP_DIR}/Formula/configlock.rb" << EOF
class Configlock < Formula
  desc "Lock config files during work hours using system-level immutable flags"
  homepage "https://github.com/${GITHUB_USER}/${REPO_NAME}"
  version "${VERSION}"
  license "MIT"

  on_macos do
    on_arm do
      url "https://github.com/${GITHUB_USER}/${REPO_NAME}/releases/download/v#{version}/configlock-darwin-arm64"
      sha256 "${SHA_DARWIN_ARM64}"
    end
    on_intel do
      url "https://github.com/${GITHUB_USER}/${REPO_NAME}/releases/download/v#{version}/configlock-darwin-amd64"
      sha256 "${SHA_DARWIN_AMD64}"
    end
  end

  on_linux do
    on_arm do
      url "https://github.com/${GITHUB_USER}/${REPO_NAME}/releases/download/v#{version}/configlock-linux-arm64"
      sha256 "${SHA_LINUX_ARM64}"
    end
    on_intel do
      url "https://github.com/${GITHUB_USER}/${REPO_NAME}/releases/download/v#{version}/configlock-linux-amd64"
      sha256 "${SHA_LINUX_AMD64}"
    end
  end

  def install
    binary_name = stable.url.split("/").last
    bin.install binary_name => "configlock"
  end

  test do
    system "#{bin}/configlock", "--version"
  end
end
EOF

echo "Formula created at ${TAP_DIR}/Formula/configlock.rb"
echo ""
echo "Next steps:"
echo ""
echo "  cd ${TAP_DIR}"
echo "  git add -A"
echo "  git commit -m \"Add configlock formula v${VERSION}\""
echo "  git push"
echo ""
echo "Then users can install with:"
echo ""
echo "  brew tap ${GITHUB_USER}/tap"
echo "  brew install configlock"
echo ""
