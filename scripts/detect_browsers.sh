#!/usr/bin/env bash
# detect_browsers.sh — find Chrome/Chromium binaries and echo szkrabok.config.toml lines
#
# Usage:
#   bash scripts/detect_browsers.sh
#
# Output:
#   For each detected browser: its version + the TOML executablePath line to use.
#   If nothing useful is found: installation suggestions.
#
# Copy the executablePath line you want into szkrabok.config.toml [default] section.
# Google Chrome stable is best for stealth (native brands). Ungoogled-chromium is a
# good second choice. The Playwright bundled binary (Chrome for Testing) should be
# avoided in production — it brands itself as automation tooling.

set -euo pipefail

FOUND=()

# ── helpers ───────────────────────────────────────────────────────────────────

get_version() {
  # Run binary with --version, strip leading "Chromium ", "Google Chrome " etc.
  timeout 5 "$1" --version 2>/dev/null | head -1 | sed 's/^[^0-9]*//' || true
}

check_binary() {
  local label="$1" path="$2"
  if [[ -x "$path" ]]; then
    local ver
    ver="$(get_version "$path")"
    if [[ -n "$ver" ]]; then
      echo "  FOUND  $label — $ver"
      echo "         executablePath = \"$path\""
      echo ""
      FOUND+=("$label")
    fi
  fi
}

check_flatpak() {
  local label="$1" app_id="$2"
  if command -v flatpak >/dev/null 2>&1 && flatpak info "$app_id" >/dev/null 2>&1; then
    local ver
    ver="$(timeout 5 flatpak run "$app_id" --version 2>/dev/null | head -1 | sed 's/^[^0-9]*//' || true)"
    if [[ -n "$ver" ]]; then
      # Write a small wrapper path check — flatpak run is the executable path
      local wrapper
      wrapper="$(command -v flatpak)"
      echo "  FOUND  $label — $ver"
      echo "         # flatpak binary — use a wrapper script or the flatpak run command:"
      echo "         executablePath = \"$HOME/.local/bin/$(echo "$app_id" | tr '.' '-' | tr '[:upper:]' '[:lower:]')\""
      echo "         # (create that wrapper: echo '#!/bin/sh' > the path, then:"
      echo "         #  echo 'exec flatpak run $app_id \"\$@\"' >> the path, chmod +x)"
      echo ""
      FOUND+=("$label")
    fi
  fi
}

check_snap() {
  local label="$1" snap_name="$2" snap_bin="$3"
  if [[ -x "$snap_bin" ]]; then
    local ver
    ver="$(get_version "$snap_bin")"
    if [[ -n "$ver" ]]; then
      echo "  FOUND  $label — $ver"
      echo "         executablePath = \"$snap_bin\""
      echo ""
      FOUND+=("$label")
    fi
  fi
}

# ── scan ──────────────────────────────────────────────────────────────────────

echo ""
echo "=== szkrabok browser detection ==="
echo ""
echo "Scanning for usable Chrome/Chromium binaries..."
echo ""

# Google Chrome stable (best for stealth — native brands)
check_binary "Google Chrome stable"       "/usr/bin/google-chrome"
check_binary "Google Chrome stable"       "/usr/bin/google-chrome-stable"
check_binary "Google Chrome stable"       "/opt/google/chrome/chrome"
check_binary "Google Chrome stable"       "/opt/google/chrome/google-chrome"

# Chromium (distro package)
check_binary "Chromium (distro)"          "/usr/bin/chromium"
check_binary "Chromium (distro)"          "/usr/bin/chromium-browser"

# Ungoogled-chromium — common wrapper locations
check_binary "Ungoogled-chromium"         "$HOME/.local/bin/ungoogled-chromium"
check_binary "Ungoogled-chromium"         "/usr/bin/ungoogled-chromium"

# Ungoogled-chromium via flatpak — only if no wrapper binary was found above
if [[ ! -x "$HOME/.local/bin/ungoogled-chromium" && ! -x "/usr/bin/ungoogled-chromium" ]]; then
  check_flatpak "Ungoogled-chromium (flatpak)" "io.github.ungoogled_software.ungoogled_chromium"
fi

# Chromium via snap
check_snap "Chromium (snap)"              "chromium" "/snap/bin/chromium"

# Brave
check_binary "Brave"                      "/usr/bin/brave-browser"
check_binary "Brave"                      "/usr/bin/brave-browser-stable"
check_binary "Brave"                      "/opt/brave.com/brave/brave"

# Microsoft Edge (Chromium-based)
check_binary "Microsoft Edge"             "/usr/bin/microsoft-edge"
check_binary "Microsoft Edge"             "/usr/bin/microsoft-edge-stable"
check_binary "Microsoft Edge"             "/opt/microsoft/msedge/msedge"

# ── results ───────────────────────────────────────────────────────────────────

if [[ ${#FOUND[@]} -eq 0 ]]; then
  echo "  NONE FOUND — no usable Chrome/Chromium binary detected."
  echo ""
  echo "  szkrabok will fall back to the Playwright bundled 'Chrome for Testing'."
  echo "  This works but is detectable as automation tooling (brands itself as"
  echo "  'Chrome for Testing' in navigator.userAgentData)."
  echo ""
  echo "  Recommended installations:"
  echo ""
  echo "  1. Google Chrome stable (best stealth — native brands):"
  echo "       https://www.google.com/chrome/"
  echo "       wget -qO- https://dl.google.com/linux/linux_signing_key.pub | sudo apt-key add -"
  echo "       sudo sh -c 'echo \"deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main\" > /etc/apt/sources.list.d/google-chrome.list'"
  echo "       sudo apt-get update && sudo apt-get install google-chrome-stable"
  echo ""
  echo "  2. Ungoogled-chromium via flatpak (no Google services, good stealth):"
  echo "       flatpak install flathub io.github.ungoogled_software.ungoogled_chromium"
  echo "       # then create a wrapper: ~/.local/bin/ungoogled-chromium"
  echo "       # with: exec flatpak run io.github.ungoogled_software.ungoogled_chromium \"\$@\""
  echo ""
else
  echo "  Copy one executablePath line above into szkrabok.config.toml [default]."
  echo ""
  echo "  Stealth ranking (best first):"
  echo "    1. Google Chrome stable — native 'Google Chrome' brands, most trusted"
  echo "    2. Ungoogled-chromium   — no Google services; needs greasy brands patch"
  echo "    3. Chromium (distro)    — same as ungoogled; needs greasy brands patch"
  echo "    4. Chrome for Testing   — avoid in production (automation-branded)"
fi

echo ""
