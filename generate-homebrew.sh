#!/bin/bash
set -e

# ============================================================================
# Homebrew Tap Generator
# ============================================================================
#
# BEFORE RUNNING THIS SCRIPT:
#
# 1. Create a GitHub release with binaries attached:
#    gh release create v0.0.1 --generate-notes --title "v0.0.1"
#    (GitHub Actions will build and attach binaries automatically)
#
# 2. Wait for GitHub Actions to complete and verify all 4 binaries exist:
#    - darwin-arm64
#    - darwin-amd64
#    - linux-arm64
#    - linux-amd64
#
# 3. Create a new GitHub repo named "homebrew-tap" under your account:
#    gh repo create baggiiiie/homebrew-tap --public --clone
#
# 4. Run this script with the version number:
#    ./homebrew.sh 0.0.1
#
# 5. After running, cd into homebrew-tap and push:
#    cd ../homebrew-tap
#    git add -A && git commit -m "Add formula v0.0.1" && git push
#
# 6. Users can then install with:
#    brew tap baggiiiie/tap
#    brew install tool
#
# ============================================================================

REPO_NAME="$1"
VERSION="${2:-0.0.1}"
GITHUB_USER="baggiiiie"
TAP_DIR="../homebrew-tap"
BASE_URL="https://github.com/${GITHUB_USER}/${REPO_NAME}/releases/download/v${VERSION}"
if [[ -z $REPO_NAME ]]; then
    echo "repo name is not set!"
    exit
fi

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
    local url="${BASE_URL}/${binary}"

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

binary_list=("darwin-arm64" "darwin-amd64" "linux-arm64" "linux-amd64")
for binary in "${binary_list[@]}"; do
    echo -n "  ${binary}: "
    SHA=$(fetch_sha "${binary}")
    echo "${SHA}"
done

echo ""
echo "Generating Formula/$REPO_NAME.rb..."

cat >"${TAP_DIR}/Formula/$REPO_NAME.rb" <<EOF
class ${REPO_NAME} < Formula
  desc "Lock ${REPO_NAME} files during work hours using system-level immutable flags"
  homepage "https://github.com/${GITHUB_USER}/${REPO_NAME}"
  version "${VERSION}"
  license "MIT"

  on_macos do
    on_arm do
      url "https://github.com/${GITHUB_USER}/${REPO_NAME}/releases/download/v#{version}/${REPO_NAME}-darwin-arm64"
      sha256 "${SHA_DARWIN_ARM64}"
    end
    on_intel do
      url "https://github.com/${GITHUB_USER}/${REPO_NAME}/releases/download/v#{version}/${REPO_NAME}-darwin-amd64"
      sha256 "${SHA_DARWIN_AMD64}"
    end
  end

  on_linux do
    on_arm do
      url "https://github.com/${GITHUB_USER}/${REPO_NAME}/releases/download/v#{version}/${REPO_NAME}-linux-arm64"
      sha256 "${SHA_LINUX_ARM64}"
    end
    on_intel do
      url "https://github.com/${GITHUB_USER}/${REPO_NAME}/releases/download/v#{version}/${REPO_NAME}-linux-amd64"
      sha256 "${SHA_LINUX_AMD64}"
    end
  end

  def install
    binary_name = stable.url.split("/").last
    bin.install binary_name => "${REPO_NAME}"
  end

  test do
    system "#{bin}/${REPO_NAME}", "--version"
  end
end
EOF

echo "Formula created at ${TAP_DIR}/Formula/$REPO_NAME.rb"
echo ""
echo "Next steps:"
echo ""
echo "  cd ${TAP_DIR}"
echo "  git add -A"
echo "  git commit -m \"Add $REPO_NAME formula v${VERSION}\""
echo "  git push"
echo ""
echo "Then users can install with:"
echo ""
echo "  brew tap ${GITHUB_USER}/tap"
echo "  brew install ${REPO_NAME}"
echo ""
