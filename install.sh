#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'

# ============================================================================
# CONFIG
# ============================================================================

readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
readonly MCP_SERVER_DIR="$SCRIPT_DIR/szkrabok.playwright.mcp.stealth"
readonly MCP_SERVER_SCRIPT="$MCP_SERVER_DIR/src/index.js"
readonly SERVER_NAME="szkrabok"
readonly SERVER_MODE="--headless"

SCOPE=""
FORCE=false

# ============================================================================
# UTIL
# ============================================================================

die() {
  echo "ERROR: $*" >&2
  exit 1
}

info() {
  echo "→ $*"
}

success() {
  echo "✔ $*"
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "Missing required command: $1"
}

# ============================================================================
# ARG PARSING
# ============================================================================

parse_args() {
  if [[ $# -eq 0 ]]; then
    return
  fi

  if [[ $# -ne 2 ]]; then
    die "Non-interactive mode requires: --scope user|local"
  fi

  if [[ "$1" != "--scope" ]]; then
    die "Invalid argument: $1"
  fi

  SCOPE="$2"
  FORCE=true
}

# ============================================================================
# INTERACTIVE
# ============================================================================

interactive_mode() {
  echo "Choose installation scope:"
  echo "  1) User (global)"
  echo "  2) Local (project)"
  read -rp "Enter choice [1-2]: " choice

  case "$choice" in
    1) SCOPE="user" ;;
    2) SCOPE="local" ;;
    *) die "Invalid choice" ;;
  esac
}

validate_scope() {
  [[ "$SCOPE" == "user" || "$SCOPE" == "local" ]] \
    || die "Scope must be 'user' or 'local'"
}

# ============================================================================
# VALIDATION
# ============================================================================

validate_environment() {
  require_cmd claude
  require_cmd node
  require_cmd npm

  [[ -f "$MCP_SERVER_SCRIPT" ]] \
    || die "Missing server entry: $MCP_SERVER_SCRIPT"

  [[ -f "$MCP_SERVER_DIR/package.json" ]] \
    || die "Missing package.json"
}

ensure_dependencies() {
  if [[ ! -d "$MCP_SERVER_DIR/node_modules" ]]; then
    info "Installing dependencies..."
    (
      cd "$MCP_SERVER_DIR"
      npm ci
    ) || die "npm ci failed"
  fi
}

# ============================================================================
# MCP INSTALL
# ============================================================================

install_server() {
  local abs_script
  abs_script="$(realpath "$MCP_SERVER_SCRIPT")"

  info "Reconciling MCP server..."

  # idempotent: remove first
  claude mcp remove "$SERVER_NAME" --scope "$SCOPE" 2>/dev/null || true

  claude mcp add \
    --scope "$SCOPE" \
    "$SERVER_NAME" \
    -- node "$abs_script" "$SERVER_MODE"
}

verify_install() {
  claude mcp list --scope "$SCOPE" \
    | awk '{print $1}' \
    | grep -Fxq "$SERVER_NAME" \
    || die "Verification failed: server not found after install"
}

# ============================================================================
# MAIN
# ============================================================================

main() {
  parse_args "$@"

  if [[ -z "$SCOPE" ]]; then
    interactive_mode
  fi

  validate_scope
  validate_environment
  ensure_dependencies
  install_server
  verify_install

  success "Installation complete (scope: $SCOPE)"
}

main "$@"
