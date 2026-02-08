#!/bin/bash
# Szkrabok Upstream Migration Script
# This script helps migrate szkrabok features onto the latest upstream playwright-mcp
#
# Usage: ./migrate.sh [--dry-run]

set -e

UPSTREAM_BRANCH="${UPSTREAM_BRANCH:-upstream/main}"
MIGRATION_BRANCH="${MIGRATION_BRANCH:-sync-upstream-$(date +%Y%m%d)}"
DRY_RUN=false

# Parse arguments
if [[ "$1" == "--dry-run" ]]; then
    DRY_RUN=true
    echo "DRY RUN MODE - No changes will be made"
fi

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# Check prerequisites
check_prerequisites() {
    log_info "Checking prerequisites..."

    if ! git rev-parse --git-dir > /dev/null 2>&1; then
        log_error "Not in a git repository"
        exit 1
    fi

    if ! git remote | grep -q "^upstream$"; then
        log_error "No 'upstream' remote found. Add with: git remote add upstream https://github.com/microsoft/playwright-mcp.git"
        exit 1
    fi

    if [[ ! -d "patches" ]]; then
        log_error "patches/ directory not found. Run from repository root."
        exit 1
    fi

    log_info "Prerequisites OK"
}

# Fetch latest upstream
fetch_upstream() {
    log_info "Fetching latest upstream..."
    if [[ "$DRY_RUN" == true ]]; then
        log_info "Would run: git fetch upstream"
    else
        git fetch upstream
    fi
}

# Check for uncommitted changes
check_clean_working_tree() {
    log_info "Checking for uncommitted changes..."
    if ! git diff-index --quiet HEAD --; then
        log_error "You have uncommitted changes. Commit or stash them first."
        git status --short
        exit 1
    fi
    log_info "Working tree is clean"
}

# Create migration branch
create_migration_branch() {
    log_info "Creating migration branch: $MIGRATION_BRANCH"

    if git rev-parse --verify "$MIGRATION_BRANCH" > /dev/null 2>&1; then
        log_warn "Branch $MIGRATION_BRANCH already exists!"
        read -p "Delete and recreate? (y/N) " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            if [[ "$DRY_RUN" == true ]]; then
                log_info "Would delete branch: $MIGRATION_BRANCH"
            else
                git branch -D "$MIGRATION_BRANCH"
            fi
        else
            log_error "Aborted"
            exit 1
        fi
    fi

    if [[ "$DRY_RUN" == true ]]; then
        log_info "Would run: git checkout -b $MIGRATION_BRANCH $UPSTREAM_BRANCH"
    else
        git checkout -b "$MIGRATION_BRANCH" "$UPSTREAM_BRANCH"
    fi
}

# Apply patches
apply_patches() {
    log_info "Applying szkrabok patches..."

    patches=(
        "patches/szkrabok-core.patch"
        "patches/szkrabok-tools.patch"
        "patches/szkrabok-registry.patch"
    )

    for patch in "${patches[@]}"; do
        if [[ ! -f "$patch" ]]; then
            log_error "Patch not found: $patch"
            exit 1
        fi

        log_info "Applying $patch..."
        if [[ "$DRY_RUN" == true ]]; then
            log_info "Would run: git apply --check $patch"
            git apply --check "$patch" 2>&1 || log_warn "Patch might have conflicts"
        else
            if git apply --check "$patch" 2>&1; then
                git apply "$patch"
                git add -A
                git commit -m "Apply $(basename "$patch")"
                log_info "✓ Applied $patch"
            else
                log_error "Failed to apply $patch"
                log_warn "You'll need to apply this patch manually"
                exit 1
            fi
        fi
    done
}

# Copy additional files
copy_additional_files() {
    log_info "Copying additional szkrabok files..."

    additional_files=(
        "index.js:index.js"
        "server.js:server.js"
        "cli.js:cli.js"
        "config.js:config.js"
        "test:test"
        "utils:utils"
    )

    for file_mapping in "${additional_files[@]}"; do
        src="${file_mapping%%:*}"
        dest="${file_mapping##*:}"

        log_info "Copying $src -> $dest"
        if [[ "$DRY_RUN" == true ]]; then
            log_info "Would copy: $src -> $dest"
        else
            if [[ -f "$src" ]]; then
                cp "$src" "$dest"
            elif [[ -d "$src" ]]; then
                cp -r "$src" "$dest"
            else
                log_warn "Source not found: $src (skipping)"
            fi
        fi
    done

    if [[ "$DRY_RUN" == false ]]; then
        git add -A
        git commit -m "Add szkrabok entry points and tests"
    fi
}

# Update package.json
update_package_json() {
    log_info "Updating package.json with szkrabok dependencies..."

    if [[ "$DRY_RUN" == true ]]; then
        log_info "Would update package.json"
        log_info "You'll need to manually merge:"
        log_info "  - playwright-extra"
        log_info "  - puppeteer-extra-plugin-stealth"
        log_info "  - commander (for CLI)"
        log_info "  - ajv (for tests)"
    else
        log_warn "package.json merge requires manual intervention"
        log_info "Add these dependencies:"
        cat <<EOF
{
  "playwright-extra": "^4.3.6",
  "puppeteer": "^24.34.0",
  "puppeteer-extra-plugin-stealth": "^2.11.2",
  "commander": "^12.0.0",
  "ajv": "^8.17.1",
  "ajv-formats": "^3.0.1"
}
EOF
        read -p "Press Enter when package.json is updated..." -r
        git add package.json
        git commit -m "Update package.json with szkrabok dependencies"
    fi
}

# Run tests
run_tests() {
    log_info "Running tests..."

    if [[ "$DRY_RUN" == true ]]; then
        log_info "Would run: npm install && npm test"
    else
        log_info "Installing dependencies..."
        npm install

        log_info "Running tests..."
        if npm test; then
            log_info "✓ All tests passed!"
        else
            log_error "Tests failed. Review and fix before continuing."
            exit 1
        fi
    fi
}

# Summary
print_summary() {
    log_info "Migration summary:"
    echo ""
    echo "Branch: $MIGRATION_BRANCH"
    echo "Patches applied: 3"
    echo "Additional files copied: Yes"
    echo "Tests: $(if [[ "$DRY_RUN" == true ]]; then echo "Not run (dry-run)"; else echo "Passed"; fi)"
    echo ""
    log_info "Next steps:"
    echo "1. Review the changes: git log --oneline -10"
    echo "2. Test manually: npm start"
    echo "3. Run stealth test: npm test -- test/scrap.test.js"
    echo "4. If satisfied, merge to main: git checkout main && git merge $MIGRATION_BRANCH"
    echo "5. Tag the release: git tag v1.2-upstream-sync"
}

# Main execution
main() {
    log_info "Starting Szkrabok upstream migration..."
    log_info "Target upstream: $UPSTREAM_BRANCH"
    log_info "Migration branch: $MIGRATION_BRANCH"
    echo ""

    check_prerequisites

    if [[ "$DRY_RUN" == false ]]; then
        check_clean_working_tree
    fi

    fetch_upstream
    create_migration_branch
    apply_patches
    copy_additional_files
    update_package_json
    run_tests

    echo ""
    print_summary

    log_info "Migration complete!"
}

main
