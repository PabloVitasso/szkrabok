#!/bin/bash
# Szkrabok Upstream Migration Script v2.0
# Enhanced with conflict resolution, changelog, rollback, and validation
#
# Usage: ./migrate-v2.sh [OPTIONS]
# Options:
#   --dry-run           Show what would be done
#   --3way              Use 3-way merge for conflicts
#   --skip-tests        Skip test execution
#   --force             Force overwrite existing branch
#   --changelog         Generate changelog from upstream commits

set -e

UPSTREAM_BRANCH="${UPSTREAM_BRANCH:-upstream/main}"
MIGRATION_BRANCH="${MIGRATION_BRANCH:-sync-upstream-$(date +%Y%m%d)}"
SZKRABOK_SRC="szkrabok.playwright.mcp.stealth/src"
DRY_RUN=false
USE_3WAY=false
SKIP_TESTS=false
FORCE=false
GEN_CHANGELOG=false

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --dry-run) DRY_RUN=true; shift ;;
        --3way) USE_3WAY=true; shift ;;
        --skip-tests) SKIP_TESTS=true; shift ;;
        --force) FORCE=true; shift ;;
        --changelog) GEN_CHANGELOG=true; shift ;;
        *) echo "Unknown option: $1"; exit 1 ;;
    esac
done

if [[ "$DRY_RUN" == true ]]; then
    echo "=== DRY RUN MODE - No changes will be made ==="
fi

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info() { echo -e "${GREEN}✓${NC} $1"; }
log_warn() { echo -e "${YELLOW}⚠${NC} $1"; }
log_error() { echo -e "${RED}✗${NC} $1"; }
log_step() { echo -e "\n${BLUE}▶${NC} $1"; }

ROLLBACK_BRANCH=""

save_rollback_point() {
    ROLLBACK_BRANCH=$(git rev-parse --abbrev-ref HEAD)
    log_info "Rollback point: $ROLLBACK_BRANCH ($(git rev-parse --short HEAD))"
}

rollback() {
    log_error "Migration failed! Rolling back..."
    if [[ -n "$ROLLBACK_BRANCH" ]] && [[ "$DRY_RUN" == false ]]; then
        git checkout "$ROLLBACK_BRANCH" 2>/dev/null || git checkout main
        git branch -D "$MIGRATION_BRANCH" 2>/dev/null || true
    fi
    exit 1
}

trap rollback ERR

check_prerequisites() {
    log_step "Checking prerequisites"

    if ! git rev-parse --git-dir > /dev/null 2>&1; then
        log_error "Not in a git repository"
        exit 1
    fi

    if ! git remote | grep -q "^upstream$"; then
        log_error "No 'upstream' remote found"
        log_info "Add with: git remote add upstream https://github.com/microsoft/playwright-mcp.git"
        exit 1
    fi

    if [[ ! -d "patches" ]]; then
        log_error "patches/ directory not found. Run from repository root."
        exit 1
    fi

    if [[ ! -d "$SZKRABOK_SRC" ]]; then
        log_error "Source directory not found: $SZKRABOK_SRC"
        exit 1
    fi

    log_info "All prerequisites met"
}

check_clean_working_tree() {
    log_step "Checking working tree"
    if ! git diff-index --quiet HEAD --; then
        log_error "Uncommitted changes detected"
        git status --short
        log_info "Commit or stash changes first"
        exit 1
    fi
    log_info "Working tree is clean"
}

fetch_upstream() {
    log_step "Fetching upstream"
    if [[ "$DRY_RUN" == true ]]; then
        log_info "Would fetch upstream"
    else
        git fetch upstream --tags
        log_info "Fetched upstream $(git describe --tags upstream/main 2>/dev/null || echo 'main')"
    fi
}

compare_upstream() {
    log_step "Comparing with upstream"

    local current_base=$(git merge-base HEAD upstream/main)
    local commits_behind=$(git rev-list --count ${current_base}..upstream/main)
    local upstream_version=$(git describe --tags upstream/main 2>/dev/null || echo "unknown")

    echo "  Upstream version: $upstream_version"
    echo "  Commits behind: $commits_behind"

    if [[ $commits_behind -eq 0 ]]; then
        log_warn "Already up to date with upstream"
        if [[ "$FORCE" == false ]]; then
            read -p "Continue anyway? (y/N) " -n 1 -r
            echo
            [[ ! $REPLY =~ ^[Yy]$ ]] && exit 0
        fi
    fi
}

generate_changelog() {
    log_step "Generating changelog"

    local changelog_file="CHANGELOG-$(date +%Y%m%d).md"
    local current_base=$(git merge-base main upstream/main 2>/dev/null || echo "HEAD~10")

    if [[ "$DRY_RUN" == true ]]; then
        log_info "Would generate: $changelog_file"
        git log --oneline ${current_base}..upstream/main | head -20
    else
        cat > "$changelog_file" <<EOF
# Upstream Changelog - $(date +%Y-%m-%d)

## Upstream Changes ($(git describe --tags upstream/main 2>/dev/null || echo "main"))

EOF
        git log --pretty=format:"- %h %s (%an, %ar)" ${current_base}..upstream/main >> "$changelog_file"

        cat >> "$changelog_file" <<EOF


## Szkrabok Patches Applied

1. szkrabok-core.patch - Session management & stealth
2. szkrabok-tools.patch - CSS selector tools
3. szkrabok-registry.patch - Unified tool registry

## Migration Details

- Source: ${current_base:0:7}
- Target: $(git rev-parse --short upstream/main)
- Branch: $MIGRATION_BRANCH
- Date: $(date +"%Y-%m-%d %H:%M:%S")

EOF
        log_info "Changelog: $changelog_file"
        [[ "$DRY_RUN" == false ]] && cat "$changelog_file"
    fi
}

create_migration_branch() {
    log_step "Creating migration branch: $MIGRATION_BRANCH"

    if git rev-parse --verify "$MIGRATION_BRANCH" > /dev/null 2>&1; then
        if [[ "$FORCE" == true ]]; then
            log_warn "Deleting existing branch: $MIGRATION_BRANCH"
            [[ "$DRY_RUN" == false ]] && git branch -D "$MIGRATION_BRANCH"
        else
            log_error "Branch exists: $MIGRATION_BRANCH"
            log_info "Use --force to overwrite"
            exit 1
        fi
    fi

    if [[ "$DRY_RUN" == true ]]; then
        log_info "Would create: $MIGRATION_BRANCH from $UPSTREAM_BRANCH"
    else
        git checkout -b "$MIGRATION_BRANCH" "$UPSTREAM_BRANCH"
        log_info "Created and switched to $MIGRATION_BRANCH"
    fi
}

validate_patches() {
    log_step "Validating patches"

    local patches=(
        "patches/szkrabok-core.patch"
        "patches/szkrabok-tools.patch"
        "patches/szkrabok-registry.patch"
    )

    for patch in "${patches[@]}"; do
        if [[ ! -f "$patch" ]]; then
            log_error "Missing patch: $patch"
            exit 1
        fi

        local lines=$(wc -l < "$patch")
        echo "  ✓ $(basename "$patch"): $lines lines"
    done
}

apply_patches() {
    log_step "Applying szkrabok patches"

    local patches=(
        "patches/szkrabok-core.patch"
        "patches/szkrabok-tools.patch"
        "patches/szkrabok-registry.patch"
    )

    for patch in "${patches[@]}"; do
        local patch_name=$(basename "$patch")
        echo ""
        log_info "Applying: $patch_name"

        if [[ "$DRY_RUN" == true ]]; then
            if git apply --check "$patch" 2>/dev/null; then
                echo "  ✓ Would apply cleanly"
            else
                log_warn "  ⚠ May have conflicts"
                git apply --check "$patch" 2>&1 | head -5
            fi
        else
            local apply_opts=""
            [[ "$USE_3WAY" == true ]] && apply_opts="--3way"

            if git apply --check "$patch" 2>/dev/null; then
                git apply $apply_opts "$patch"
                git add -A
                git commit -m "Apply $patch_name

- Automated merge via migrate-v2.sh
- Source: szkrabok v2.0
- Date: $(date +%Y-%m-%d)"
                log_info "Applied successfully"
            else
                log_error "Patch failed: $patch_name"
                echo ""
                echo "Conflict details:"
                git apply --check "$patch" 2>&1 | head -10
                echo ""

                if [[ "$USE_3WAY" == true ]]; then
                    log_warn "Attempting 3-way merge..."
                    if git apply --3way "$patch"; then
                        log_info "3-way merge successful, but review conflicts"
                        git status --short
                        read -p "Resolve conflicts and press Enter to continue..."
                        git add -A
                        git commit -m "Apply $patch_name (with manual conflict resolution)"
                    else
                        log_error "3-way merge also failed"
                        exit 1
                    fi
                else
                    log_info "Re-run with --3way for conflict resolution"
                    exit 1
                fi
            fi
        fi
    done
}

copy_additional_files() {
    log_step "Copying szkrabok source files"

    # Define file mappings: source:destination
    local files=(
        "$SZKRABOK_SRC/index.js:src/index.js"
        "$SZKRABOK_SRC/server.js:src/server.js"
        "$SZKRABOK_SRC/cli.js:src/cli.js"
        "$SZKRABOK_SRC/config.js:src/config.js"
    )

    local dirs=(
        "$SZKRABOK_SRC/utils:src/utils"
    )

    for mapping in "${files[@]}"; do
        local src="${mapping%%:*}"
        local dest="${mapping##*:}"

        if [[ -f "$src" ]]; then
            echo "  ✓ $(basename "$src")"
            [[ "$DRY_RUN" == false ]] && cp "$src" "$dest"
        else
            log_warn "Source not found: $src"
        fi
    done

    for mapping in "${dirs[@]}"; do
        local src="${mapping%%:*}"
        local dest="${mapping##*:}"

        if [[ -d "$src" ]]; then
            echo "  ✓ $(basename "$src")/"
            [[ "$DRY_RUN" == false ]] && cp -r "$src" "$dest"
        else
            log_warn "Directory not found: $src"
        fi
    done

    if [[ "$DRY_RUN" == false ]]; then
        git add -A
        git commit -m "Add szkrabok entry points and utilities

- Copied from $SZKRABOK_SRC
- Includes: index.js, server.js, cli.js, config.js, utils/
- Date: $(date +%Y-%m-%d)"
        log_info "Files copied and committed"
    fi
}

merge_package_json() {
    log_step "Merging package.json"

    local upstream_pkg="package.json"
    local szkrabok_pkg="$SZKRABOK_SRC/../package.json"

    if [[ ! -f "$szkrabok_pkg" ]]; then
        log_warn "Szkrabok package.json not found: $szkrabok_pkg"
        return
    fi

    if [[ "$DRY_RUN" == true ]]; then
        log_info "Would merge dependencies from $szkrabok_pkg"
        echo "  Required szkrabok deps:"
        grep -A 10 '"dependencies"' "$szkrabok_pkg" | grep -E "playwright-extra|puppeteer|commander|ajv" || echo "  (none found)"
        return
    fi

    # Use Node.js to merge package.json
    node -e "
const fs = require('fs');
const upstream = JSON.parse(fs.readFileSync('$upstream_pkg', 'utf8'));
const szkrabok = JSON.parse(fs.readFileSync('$szkrabok_pkg', 'utf8'));

// Merge dependencies
const szk_deps = {
    'playwright-extra': szkrabok.dependencies['playwright-extra'],
    'puppeteer': szkrabok.dependencies['puppeteer'],
    'puppeteer-extra-plugin-stealth': szkrabok.dependencies['puppeteer-extra-plugin-stealth'],
    'commander': szkrabok.dependencies['commander']
};

const szk_dev_deps = {
    'ajv': szkrabok.devDependencies?.['ajv'],
    'ajv-formats': szkrabok.devDependencies?.['ajv-formats']
};

upstream.dependencies = { ...upstream.dependencies, ...szk_deps };
upstream.devDependencies = { ...upstream.devDependencies, ...szk_dev_deps };

// Add szkrabok scripts if missing
if (!upstream.scripts.cli) {
    upstream.scripts.cli = 'node src/cli.js';
}

fs.writeFileSync('$upstream_pkg', JSON.stringify(upstream, null, 2) + '\n');
console.log('✓ Merged package.json');
" || log_error "Failed to merge package.json"

    git add package.json
    git commit -m "Merge package.json with szkrabok dependencies

- Added: playwright-extra, puppeteer-extra-plugin-stealth
- Added: commander (CLI), ajv (validation)
- Preserved upstream versions where possible"

    log_info "Dependencies merged"
}

install_dependencies() {
    log_step "Installing dependencies"

    if [[ "$DRY_RUN" == true ]]; then
        log_info "Would run: npm install"
        return
    fi

    npm install
    log_info "Dependencies installed"
}

run_tests() {
    if [[ "$SKIP_TESTS" == true ]]; then
        log_warn "Skipping tests (--skip-tests)"
        return
    fi

    log_step "Running tests"

    if [[ "$DRY_RUN" == true ]]; then
        log_info "Would run: npm test"
        return
    fi

    if npm test; then
        log_info "All tests passed ✓"
    else
        log_error "Tests failed"
        log_warn "Review failures before merging"
        read -p "Continue anyway? (y/N) " -n 1 -r
        echo
        [[ ! $REPLY =~ ^[Yy]$ ]] && exit 1
    fi
}

print_summary() {
    log_step "Migration Summary"

    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "  Branch: $MIGRATION_BRANCH"
    echo "  Upstream: $(git describe --tags upstream/main 2>/dev/null || echo 'main')"
    echo "  Commits: $(git rev-list --count upstream/main..HEAD 2>/dev/null || echo 'N/A')"
    echo "  Status: $(if [[ "$DRY_RUN" == true ]]; then echo "DRY RUN"; else echo "COMPLETE"; fi)"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""

    if [[ "$DRY_RUN" == false ]]; then
        log_info "Next steps:"
        echo "  1. Review changes: git log --oneline -10"
        echo "  2. Test manually: cd szkrabok.playwright.mcp.stealth && npm start"
        echo "  3. Merge to main: git checkout main && git merge $MIGRATION_BRANCH"
        echo "  4. Tag release: git tag v2.0-upstream-$(date +%Y%m%d)"
        echo "  5. Push: git push origin main --tags"
    else
        log_info "To execute migration: ./migrate-v2.sh"
        echo "  Options: --3way --skip-tests --force --changelog"
    fi
    echo ""
}

main() {
    echo ""
    echo "╔══════════════════════════════════════════════╗"
    echo "║  Szkrabok Upstream Migration v2.0            ║"
    echo "╚══════════════════════════════════════════════╝"
    echo ""

    check_prerequisites

    if [[ "$DRY_RUN" == false ]]; then
        check_clean_working_tree
        save_rollback_point
    fi

    fetch_upstream
    compare_upstream

    if [[ "$GEN_CHANGELOG" == true ]]; then
        generate_changelog
    fi

    validate_patches
    create_migration_branch
    apply_patches
    copy_additional_files
    merge_package_json
    install_dependencies
    run_tests

    print_summary

    trap - ERR  # Remove error trap after success
    log_info "Migration complete! 🎉"
}

main
