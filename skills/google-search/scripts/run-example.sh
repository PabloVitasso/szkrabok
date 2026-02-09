#!/bin/bash
# Run Google Search Examples
#
# Usage:
#   ./run-example.sh basic          # Run basic search
#   ./run-example.sh multiple       # Run multiple searches
#   ./run-example.sh extract        # Extract search results

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXAMPLES_DIR="$SCRIPT_DIR/../examples"

show_usage() {
  echo "Usage: $0 <example>"
  echo ""
  echo "Available examples:"
  echo "  basic     - Basic single search with screenshot"
  echo "  multiple  - Multiple searches in one session"
  echo "  extract   - Extract structured result data"
  echo ""
  echo "Examples:"
  echo "  $0 basic"
  echo "  $0 multiple"
}

if [ $# -eq 0 ]; then
  show_usage
  exit 1
fi

EXAMPLE="$1"

case "$EXAMPLE" in
  basic)
    echo "Running basic search example..."
    node "$EXAMPLES_DIR/basic-search.js"
    ;;
  multiple)
    echo "Running multiple searches example..."
    node "$EXAMPLES_DIR/multiple-searches.js"
    ;;
  extract)
    echo "Running extract results example..."
    node "$EXAMPLES_DIR/extract-results.js"
    ;;
  *)
    echo "Error: Unknown example '$EXAMPLE'"
    echo ""
    show_usage
    exit 1
    ;;
esac
