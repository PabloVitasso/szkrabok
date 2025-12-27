# ARCHITECTURAL DECISION LOG

## DAR-001: 1 session = 1 context, not process
**Date:** $(date +%Y-%m-%d)
**Status:** ACCEPTED
**Context:** Need lightweight isolation between sessions without process overhead
**Decision:** Use Playwright browser contexts instead of separate browser processes
**Consequences:** Faster startup, less memory, but limited isolation (shared browser process)

## DAR-002: Lazy browser initialization
**Date:** $(date +%Y-%m-%d)
**Status:** ACCEPTED
**Context:** Avoid browser overhead when MCP server starts but not used
**Decision:** Browser launched on first tool call, not server startup
**Consequences:** First operation slower, but server starts instantly

## DAR-003: Headful mode by default
**Date:** $(date +%Y-%m-%d)
**Status:** ACCEPTED
**Context:** Debugging visibility and anti-detection requirements
**Decision:** Always launch browser with headless: false
**Consequences:** Visible browser windows, better compatibility with detection

## DAR-004: Best-effort stealth
**Date:** $(date +%Y-%m-%d)
**Status:** ACCEPTED
**Context:** Stealth plugin can fail on some systems
**Decision:** Try stealth first, fall back to regular Playwright if fails
**Consequences:** Graceful degradation, consistent availability

## DAR-005: Session limit of 5
**Date:** $(date +%Y-%m-%d)
**Status:** ACCEPTED
**Context:** Prevent memory exhaustion on shared systems
**Decision:** Maximum 5 concurrent sessions, auto-cleanup oldest
**Consequences:** Resource protection, but limits parallel usage
