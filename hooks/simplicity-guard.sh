#!/usr/bin/env bash
# =============================================================================
# simplicity-guard.sh -- Claude Code PreToolUse hook
#
# Blocks Claude from executing a tool call when the words "simple" or
# "simplest" are detected in its reasoning or text output for the current
# turn. Forces a user interaction point before the next tool runs.
#
# Problem
# -------
# Claude routinely downgrades estimated task complexity mid-response with
# phrases like "this is a trivial fix" or "the most straightforward approach".
# When this happens inside a thinking block or text response, it silently
# lowers the quality bar for all subsequent tool calls in the same turn:
# edge cases are skipped, existing code is not read, assumptions replace
# investigation.
#
# See: https://github.com/anthropics/claude-code/issues/42796
#
# Hook lifecycle
# --------------
# Claude Code fires PreToolUse immediately before executing each tool call.
# By this point Claude has already written its thinking and text output but
# has not yet acted on them. This is the earliest blockable event that can
# observe Claude's output text -- there is no hook between "Claude streams
# text" and "PreToolUse". Blocking here (exit 2) causes Claude Code to relay
# the reason to the user, who then decides whether to redirect or continue.
#
# Why transcript scanning
# -----------------------
# The hook receives JSON on stdin with tool name, tool input, session ID, and
# transcript_path -- but NOT Claude's reasoning text. The only way to access
# the text is via the transcript file. Built-in hook filters (matcher, if)
# can only match tool names and tool arguments, not transcript content.
#
# Transcript format: JSONL, one complete JSON object per line per turn.
# Assistant turns have message.content as an array of typed blocks:
#   { "type": "thinking", "thinking": "..." }
#   { "type": "text",     "text": "..." }
#   { "type": "tool_use", "name": "...", "input": {...} }
#
# Why (device, inode, offset) state tracking
# -------------------------------------------
# Naive grep on the full transcript is O(session length) -- re-reads every
# prior turn on every hook call. tail -1 is unreliable: the last line may be
# a system/queue-operation/last-prompt entry, not the assistant turn.
#
# Instead we track (device, inode, offset) in a state file co-located with
# the transcript. Each hook call reads only the delta since the last call:
#   - inode change  -> file was rotated or replaced, reset to 0
#   - size < offset -> file was truncated in place, reset to 0
#   - otherwise     -> seek to saved offset, read new bytes only
#
# This makes I/O O(delta) regardless of session length.
#
# Why sentinel for trailing newline detection
# -------------------------------------------
# bash $() strips trailing newlines from command substitution output.
# We cannot tell from $DELTA whether the original bytes ended with \n
# (complete last line) or not (partial write mid-line). To preserve this
# information, we append a sentinel char X in the same subshell:
#
#   DELTA_RAW=$(tail ...; printf X)
#
# If original ended \n: DELTA_RAW ends \nX -> ${: -2:1} == \n -> complete
# If original ended mid-line: DELTA_RAW ends ...charX -> != \n -> partial
#
# When partial, we back up SAFE_SIZE to the start of the incomplete line so
# the next hook call re-reads it once fully written. This prevents a
# permanent miss where a partial line's trigger word is skipped by jq's
# try/empty and the offset advances past it before it can be re-read.
#
# State is written to SAFE_SIZE BEFORE detection. If the hook is killed
# mid-run, the offset advances and the delta is not re-scanned on the next
# invocation (no duplicate block signals; one missed detection window on crash).
#
# Why jq, not raw grep
# --------------------
# Raw grep on the delta fires on any line containing the trigger word:
# tool results, system messages, hook feedback echoes, and Claude's own
# acknowledgment of the block. This causes a cascade where the block
# re-triggers on every subsequent tool call in the same turn.
#
# jq filters to assistant entries only, extracting text and thinking block
# content exclusively. Feedback echoes land as tool_result/system entries
# and are never seen by detection. The cascade is eliminated by design.
#
# If jq itself fails (crash, binary error), we fall back to raw grep on the
# delta -- loses assistant-only isolation but guarantees no silent miss.
#
# One-block-per-turn flag
# -----------------------
# Even with jq filtering, Claude's acknowledgment text (an assistant entry)
# may contain the trigger word. The BLOCKED flag suppresses detection after
# the first fire. It resets when a new user message ("type":"user") appears
# in the delta, marking the start of a new turn.
#
# Install
# -------
# 1. chmod +x ~/.claude/hooks/simplicity-guard.sh
#    (or symlink: ln -s /path/to/szkrabok/hooks/simplicity-guard.sh ~/.claude/hooks/)
# 2. Add to ~/.claude/settings.json:
#
#    {
#      "hooks": {
#        "PreToolUse": [
#          {
#            "matcher": "",
#            "hooks": [
#              {
#                "type": "command",
#                "command": "~/.claude/hooks/simplicity-guard.sh"
#              }
#            ]
#          }
#        ]
#      }
#    }
#
# =============================================================================
set -euo pipefail

# --- guard: jq required -- fail loudly, do NOT touch state ---
if ! command -v jq &>/dev/null; then
    printf 'simplicity-guard: jq not found -- hook inactive.\n' >&2
    printf 'Install: https://jqlang.org/download/\n' >&2
    exit 1
fi

# --- read hook input from stdin ---
INPUT=$(cat)

TRANSCRIPT=$(printf '%s' "$INPUT" | python3 -c \
    "import json,sys; print(json.load(sys.stdin)['transcript_path'])")

# state file co-located with transcript -- persists across restarts
STATE="${TRANSCRIPT}.simplecheck.state"

PATTERN='\b(simple|simplest)\b'

# --- load saved state ---
if [[ -f "$STATE" ]]; then
    read -r S_DEV S_INO S_OFF S_BLOCKED < "$STATE"
else
    S_DEV=0; S_INO=0; S_OFF=0; S_BLOCKED=0
fi

# --- current file stats ---
read -r C_DEV C_INO C_SIZE < <(stat -c '%d %i %s' "$TRANSCRIPT")

# --- decide start offset ---
if [[ "$C_DEV" == "$S_DEV" && "$C_INO" == "$S_INO" ]] && (( C_SIZE >= S_OFF )); then
    START=$S_OFF        # same file, resume from last position
else
    START=0             # rotated, replaced, or truncated -- re-scan from top
    S_BLOCKED=0
fi

# --- read delta with sentinel to preserve trailing newline information ---
# $() strips trailing newlines; appending X in the same subshell prevents
# loss of that information. See header comment for full rationale.
DELTA_RAW=""
DELTA=""
if (( C_SIZE > START )); then
    DELTA_RAW=$(tail -c +$(( START + 1 )) "$TRANSCRIPT"; printf X)
    DELTA="${DELTA_RAW%X}"
fi

# --- determine safe offset: back up past any incomplete last line ---
# If the last byte of the delta is not \n, the final line was mid-write
# when the hook fired. We back SAFE_SIZE up to the start of that line so
# the next hook call re-reads it once fully written, preventing a permanent
# miss. ${DELTA%$'\n'*} removes from the last \n to end (shortest suffix
# match), giving everything up to the last complete newline.
SAFE_SIZE=$C_SIZE
if [[ -n "$DELTA" ]] && [[ "${DELTA_RAW: -2:1}" != $'\n' ]]; then
    TRIMMED="${DELTA%$'\n'*}"
    if [[ "$TRIMMED" != "$DELTA" ]]; then
        # +1 to include the \n itself in the safe region
        SAFE_SIZE=$(( START + $(printf '%s' "$TRIMMED" | wc -c) + 1 ))
    else
        # no complete lines in delta yet -- back up to START
        SAFE_SIZE=$START
    fi
fi

# --- new user turn resets blocked flag ---
if echo "$DELTA" | grep -q '"type":"user"'; then
    S_BLOCKED=0
fi

# --- persist state before detection (no re-scan if killed mid-run) ---
echo "$C_DEV $C_INO $SAFE_SIZE $S_BLOCKED" > "$STATE"

# --- skip detection if already fired this turn ---
if (( S_BLOCKED == 1 )); then
    exit 0
fi

# --- extract assistant text/thinking blocks and detect trigger words ---
# jq receives the delta only (not the full transcript).
# -R reads each line as a raw string; try/empty silently skips lines that
# fail fromjson -- including any partial line at the end of the delta if
# the producer was mid-write when the hook fired (offset backed up above,
# so the partial line will be re-read complete on the next hook call).
# If jq itself fails (crash, binary error), fall back to raw grep on the
# delta -- loses assistant-only isolation but guarantees no silent miss.
JQ_OUT=""
JQ_EXIT=0
if [[ -n "$DELTA" ]]; then
    JQ_OUT=$(echo "$DELTA" \
        | jq -Rr 'try (fromjson
                      | select(.type == "assistant")
                      | .message.content[]?
                      | select(.type == "text" or .type == "thinking")
                      | (.text // .thinking)
                      ) // empty' 2>/dev/null) || JQ_EXIT=$?
fi

if (( JQ_EXIT != 0 )); then
    HAYSTACK="$DELTA"   # jq failed -- fall back to raw delta
else
    HAYSTACK="$JQ_OUT"
fi

if [[ -n "$HAYSTACK" ]] && echo "$HAYSTACK" | grep -qiE "$PATTERN"; then
    echo "$C_DEV $C_INO $SAFE_SIZE 1" > "$STATE"
    cat >&2 <<'MSG'
HOOK BLOCKED: complexity underestimation detected in reasoning.
Do not proceed. Ask the user this exact question:

  You flagged this as straightforward -- how do you want to continue?

  1. Show the approach you had in mind
  2. Research mode: use tools to find 3 alternative solutions,
     sorted by industry-standard usage (most common first)
  3. Override -- continue as planned

Wait for the user to pick an option before calling any tool.
MSG
    exit 2
fi

exit 0
