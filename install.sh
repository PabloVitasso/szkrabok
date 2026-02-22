#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'

readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
readonly MCP_SERVER_DIR="$SCRIPT_DIR/."
readonly MCP_SERVER_SCRIPT="$MCP_SERVER_DIR/src/index.js"
readonly SERVER_NAME="szkrabok"
readonly SERVER_MODE="--headless"

SCOPE=""
FORCE=false
CLEAN_ALL=false

die() {
  echo "ERROR: $*" >&2
  exit 1
}

info() {
  echo "-> $*"
}

success() {
  echo "* $*"
}

run_cmd() {
  local cmd="$1"
  shift
  printf "$ %s" "$cmd"
  if [[ $# -gt 0 ]]; then
    printf " %s" "$@"
  fi
  printf "\n" >&2
  "$cmd" "$@"
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "Missing required command: $1"
}

parse_args() {
  if [[ $# -eq 0 ]]; then
    return
  fi

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --scope)
        [[ $# -ge 2 ]] || die "--scope requires an argument"
        SCOPE="$2"
        FORCE=true
        shift 2
        ;;
      --clean-all)
        CLEAN_ALL=true
        shift
        ;;
      *)
        die "Unknown argument: $1"
        ;;
    esac
  done

  if [[ "$FORCE" == "true" && -z "$SCOPE" ]]; then
    die "Non-interactive mode requires: --scope user|local"
  fi
}

interactive_mode() {
  echo "Scope: 1) User 2) Local"
  read -rp "Choice [1-2]: " choice

  case "$choice" in
    1) SCOPE="user" ;;
    2) SCOPE="local" ;;
    *) die "Invalid choice" ;;
  esac

  echo "Clean all scopes? 1) No (recommended) 2) Yes"
  read -rp "Choice [1-2]: " clean_choice

  case "$clean_choice" in
    1) CLEAN_ALL=false ;;
    2) CLEAN_ALL=true ;;
    *) die "Invalid choice" ;;
  esac
}

validate_scope() {
  [[ "$SCOPE" == "user" || "$SCOPE" == "local" ]] \
    || die "Scope must be 'user' or 'local'"
}

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
    info "npm ci..."
    (
      cd "$MCP_SERVER_DIR"
      run_cmd npm ci
    ) || die "npm ci failed"
  fi
}

clean_all_scopes() {
  info "Cleaning all scopes..."

  for scope in user local; do
    info "Remove $scope..."
    run_cmd claude mcp remove "$SERVER_NAME" --scope "$scope" 2>/dev/null || true
  done
}

check_other_scope() {
  local other_scope
  case "$SCOPE" in
    user)  other_scope="local" ;;
    local) other_scope="user" ;;
  esac

  if claude mcp get "$SERVER_NAME" 2>&1 | grep -q "Scope: ${other_scope^} config"; then
    echo "WARNING: Also exists in $other_scope scope (use --clean-all to remove both)" >&2
  fi
}

install_server() {
  local abs_script
  abs_script="$(realpath "$MCP_SERVER_SCRIPT")"

  info "Install $SCOPE..."

  if [[ "$CLEAN_ALL" == "true" ]]; then
    clean_all_scopes
  else
    info "Remove existing $SCOPE..."
    run_cmd claude mcp remove "$SERVER_NAME" --scope "$SCOPE" 2>/dev/null || true

    check_other_scope
  fi

  info "Add to $SCOPE..."
  run_cmd claude mcp add \
    --scope "$SCOPE" \
    "$SERVER_NAME" \
    -- node "$abs_script" "$SERVER_MODE"
}

verify_install() {
  local output scope_line expected_scope

  info "Verify..."
  output="$(claude mcp get "$SERVER_NAME" 2>&1)" || die "Server not found"

  scope_line="$(echo "$output" | grep "^  Scope:" | head -1)"

  case "$SCOPE" in
    user)  expected_scope="User config" ;;
    local) expected_scope="Local config" ;;
  esac

  if echo "$scope_line" | grep -q "$expected_scope"; then
    success "OK: $scope_line"
  else
    if [[ "$SCOPE" == "user" ]] && echo "$scope_line" | grep -q "Local config"; then
      die "Local scope overrides user. Use: ./install.sh --scope user --clean-all"
    else
      die "Expected '$expected_scope', got: $scope_line"
    fi
  fi
}

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

  success "Done ($SCOPE)"
}

main "$@"
