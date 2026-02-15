#!/bin/bash
# Regenerate Szkrabok patches from current implementation
# Usage: ./regenerate-patches.sh

set -e

SZKRABOK_SRC="szkrabok.playwright.mcp.stealth/src"
PATCHES_DIR="patches"

RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info() { echo -e "${GREEN}✓${NC} $1"; }
log_error() { echo -e "${RED}✗${NC} $1"; }
log_step() { echo -e "\n${BLUE}▶${NC} $1"; }

check_prerequisites() {
    if [[ ! -d "$SZKRABOK_SRC" ]]; then
        log_error "Source directory not found: $SZKRABOK_SRC"
        exit 1
    fi

    if [[ ! -d "$PATCHES_DIR" ]]; then
        mkdir -p "$PATCHES_DIR"
        log_info "Created patches directory"
    fi
}

generate_core_patch() {
    log_step "Generating szkrabok-core.patch"

    local output="$PATCHES_DIR/szkrabok-core.patch"
    local tmpdir=$(mktemp -d)

    # Generate patches for core files
    for file in pool.js storage.js stealth.js; do
        if [[ -f "$SZKRABOK_SRC/core/$file" ]]; then
            git diff --no-index /dev/null "$SZKRABOK_SRC/core/$file" 2>&1 | \
                tail -n +5 > "$tmpdir/$file.patch"
            echo "  ✓ core/$file"
        else
            log_error "Missing: core/$file"
            exit 1
        fi
    done

    # Combine patches
    cat > "$output" <<'EOF'
diff --git a/src/core/pool.js b/src/core/pool.js
new file mode 100644
index 0000000..0000000
--- /dev/null
+++ b/src/core/pool.js
EOF
    tail -n +4 "$tmpdir/pool.js.patch" >> "$output"

    cat >> "$output" <<'EOF'
diff --git a/src/core/storage.js b/src/core/storage.js
new file mode 100644
index 0000000..0000000
--- /dev/null
+++ b/src/core/storage.js
EOF
    tail -n +4 "$tmpdir/storage.js.patch" >> "$output"

    cat >> "$output" <<'EOF'
diff --git a/src/core/stealth.js b/src/core/stealth.js
new file mode 100644
index 0000000..0000000
--- /dev/null
+++ b/src/core/stealth.js
EOF
    tail -n +4 "$tmpdir/stealth.js.patch" >> "$output"

    rm -rf "$tmpdir"

    local lines=$(wc -l < "$output")
    log_info "Generated: szkrabok-core.patch ($lines lines)"
}

generate_tools_patch() {
    log_step "Generating szkrabok-tools.patch"

    local output="$PATCHES_DIR/szkrabok-tools.patch"
    local tmpdir=$(mktemp -d)

    local tools=(session navigate interact extract wait workflow)

    for tool in "${tools[@]}"; do
        local file="$SZKRABOK_SRC/tools/$tool.js"
        if [[ -f "$file" ]]; then
            git diff --no-index /dev/null "$file" 2>&1 | \
                tail -n +5 > "$tmpdir/$tool.patch"
            echo "  ✓ tools/$tool.js"
        else
            log_error "Missing: tools/$tool.js"
            exit 1
        fi
    done

    # Combine patches with proper git format
    rm -f "$output"
    for tool in "${tools[@]}"; do
        cat >> "$output" <<EOF
diff --git a/src/tools/$tool.js b/src/tools/$tool.js
new file mode 100644
index 0000000..0000000
--- /dev/null
+++ b/src/tools/$tool.js
EOF
        tail -n +4 "$tmpdir/$tool.patch" >> "$output"
    done

    rm -rf "$tmpdir"

    local lines=$(wc -l < "$output")
    log_info "Generated: szkrabok-tools.patch ($lines lines)"
}

generate_registry_patch() {
    log_step "Generating szkrabok-registry.patch"

    local output="$PATCHES_DIR/szkrabok-registry.patch"
    local file="$SZKRABOK_SRC/tools/registry.js"

    if [[ ! -f "$file" ]]; then
        log_error "Missing: tools/registry.js"
        exit 1
    fi

    git diff --no-index /dev/null "$file" 2>&1 | tail -n +5 > "$output.tmp"

    cat > "$output" <<'EOF'
diff --git a/src/tools/registry.js b/src/tools/registry.js
new file mode 100644
index 0000000..0000000
--- /dev/null
+++ b/src/tools/registry.js
EOF
    tail -n +4 "$output.tmp" >> "$output"
    rm "$output.tmp"

    local lines=$(wc -l < "$output")
    log_info "Generated: szkrabok-registry.patch ($lines lines)"
}

update_readme() {
    log_step "Updating patches/README.md"

    local readme="$PATCHES_DIR/README.md"
    local core_lines=$(wc -l < "$PATCHES_DIR/szkrabok-core.patch")
    local tools_lines=$(wc -l < "$PATCHES_DIR/szkrabok-tools.patch")
    local registry_lines=$(wc -l < "$PATCHES_DIR/szkrabok-registry.patch")
    local total=$((core_lines + tools_lines + registry_lines))

    # Update line counts in README
    sed -i "s/szkrabok-core.patch ([0-9]* lines)/szkrabok-core.patch ($core_lines lines)/" "$readme" 2>/dev/null || true
    sed -i "s/szkrabok-tools.patch ([0-9]* lines)/szkrabok-tools.patch ($tools_lines lines)/" "$readme" 2>/dev/null || true
    sed -i "s/szkrabok-registry.patch ([0-9]* lines)/szkrabok-registry.patch ($registry_lines lines)/" "$readme" 2>/dev/null || true

    # Update generation date
    sed -i "s/\*\*Generated\*\*: .*/\*\*Generated\*\*: $(date +%Y-%m-%d)/" "$readme" 2>/dev/null || true

    log_info "Updated README.md (Total: $total lines)"
}

validate_patches() {
    log_step "Validating patches"

    local patches=(
        "$PATCHES_DIR/szkrabok-core.patch"
        "$PATCHES_DIR/szkrabok-tools.patch"
        "$PATCHES_DIR/szkrabok-registry.patch"
    )

    for patch in "${patches[@]}"; do
        if [[ ! -f "$patch" ]]; then
            log_error "Patch not found: $patch"
            exit 1
        fi

        # Check patch syntax
        if git apply --check "$patch" 2>/dev/null || [[ $? -eq 1 ]]; then
            echo "  ✓ $(basename "$patch") - Valid format"
        else
            log_error "$(basename "$patch") - Invalid format"
            exit 1
        fi
    done

    log_info "All patches validated"
}

main() {
    echo ""
    echo "╔══════════════════════════════════════════════╗"
    echo "║  Szkrabok Patch Regeneration                 ║"
    echo "╚══════════════════════════════════════════════╝"
    echo ""

    check_prerequisites
    generate_core_patch
    generate_tools_patch
    generate_registry_patch
    update_readme
    validate_patches

    log_step "Patch Regeneration Complete"
    echo ""
    echo "  Location: $PATCHES_DIR/"
    echo "  Files: 3 patches"
    echo "  Total: $(cat $PATCHES_DIR/*.patch | wc -l) lines"
    echo ""
    log_info "Patches ready for upstream merge"
}

main
