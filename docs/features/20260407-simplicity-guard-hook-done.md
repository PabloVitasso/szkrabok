# Feature: Simplicity guard hook

> Upstream issue: [anthropics/claude-code#42796](https://github.com/anthropics/claude-code/issues/42796)

## Goal

Detect when Claude uses the words "simple" or "simplest" in its reasoning or
text output and immediately block execution, giving the user an opportunity to
intervene before the next tool call runs.

## Problem

Claude routinely downgrades estimated task complexity mid-response with phrases
like "this is simple", "the simplest approach", or "just a simple fix". When
this happens inside a chain of thought, it silently lowers the quality bar
for the rest of the turn: edge cases get skipped, existing code is not read,
assumptions replace investigation.

By the time the user sees the result, multiple tool calls have already
executed under the oversimplified framing. Correcting the direction requires
re-running the whole turn.

The user wants to intercept the moment the word appears and decide whether to
let Claude continue or redirect.

## Feature request

A Claude Code hook that:

1. Fires as early as possible after the word "simple" or "simplest" appears
   in Claude's output.
2. Blocks the next tool call until the user explicitly decides to continue or
   abort.
3. Adds zero LLM cost — no model calls, no extra API round trips.
4. Scales correctly as conversations grow — I/O must stay proportional to
   new content only, not total session length.

## Technical path

### Why a hook, not a prompt instruction

A prompt-level instruction ("do not use the word simple") is advisory. Claude
may still produce the word inside a thinking block or in free text, and the
instruction adds tokens to every request. A hook is enforced by the shell
before the tool runs — the model never gets the chance to proceed.

### Why PreToolUse

Claude Code fires hooks at discrete lifecycle points. The full order is:

```
SessionStart
InstructionsLoaded
UserPromptSubmit

  [ Claude streams thinking + text ]   <-- word appears here, no hook

PreToolUse                             <-- first blockable event after text
PostToolUse
Stop
```

`UserPromptSubmit` fires before Claude starts reasoning — too early.
`Stop` fires after all tools have executed — too late, damage done.
`PreToolUse` is the earliest hook that fires after Claude has written output
and can block what happens next.

There is no hook between "Claude starts streaming" and `PreToolUse`. This is
a hard architectural limit of Claude Code.

### Why transcript scanning

The `PreToolUse` hook receives this JSON on stdin:

```json
{
  "session_id": "...",
  "transcript_path": "/home/user/.claude/projects/.../session.jsonl",
  "hook_event_name": "PreToolUse",
  "tool_name": "Bash",
  "tool_input": { "command": "..." },
  "cwd": "...",
  "permission_mode": "default"
}
```

Claude's reasoning text is not in the hook input. The only way to access it
is via the transcript file at `transcript_path`.

The `matcher` and `if` fields in hook configuration can only filter on tool
name and tool arguments — not on Claude's text output. There is no built-in
content filter for transcript text.

### Transcript format

The transcript is a JSONL file: one complete JSON object per line, appended
as the session progresses. Observed line types:

- `user` — user message, `message.content` is a string
- `assistant` — Claude turn, `message.content` is an array of typed blocks
- `system` — metadata (duration, message count)
- `file-history-snapshot` — file state for undo
- `queue-operation` — internal queue events
- `last-prompt` — most recent prompt pointer

An assistant turn looks like:

```json
{
  "type": "assistant",
  "uuid": "...",
  "timestamp": "...",
  "sessionId": "...",
  "message": {
    "role": "assistant",
    "content": [
      { "type": "thinking", "thinking": "Claude's internal reasoning..." },
      { "type": "text",     "text":     "Claude's visible response..." },
      { "type": "tool_use", "name": "Bash", "input": { "command": "..." } }
    ]
  }
}
```

Key observations:
- One line per complete turn — not streamed per-chunk.
- `thinking` blocks contain the chain of thought (extended thinking mode).
- `text` blocks contain the visible response prose.
- Both are in the same line as the `tool_use` block that triggers PreToolUse.
- `tail -1` is unreliable: the last line may be `system`, `queue-operation`,
  or `last-prompt`, not the assistant turn.
- The hook covers both thinking-mode reasoning AND visible text — whichever
  Claude uses, the trigger word is caught.

### The I/O problem with naive approaches

A grep on the full transcript file is O(session length): it re-reads
every prior turn on every hook invocation. As conversations grow, this
degrades monotonically.

`tail -N` with a fixed line count is heuristic and has two silent failure
modes: it may re-scan content already checked (duplicate signals), or skip
content if a turn spans more lines than expected.

## Solution: (device, inode, offset) state tracking

Track four values per session in a persistent state file:

- **device** — filesystem device ID
- **inode** — file inode number
- **offset** — byte position of last read
- **blocked** — whether the hook already fired this turn (1/0)

On each hook invocation:

1. Read state from `$TRANSCRIPT_PATH.simplecheck.state` (co-located, persistent).
2. `stat` the transcript to get current `(device, inode, size)`.
3. If `(device, inode)` matches state and `size >= offset`: resume from saved offset.
4. If not: file was rotated or replaced — reset offset to 0, clear blocked flag.
5. If `size < saved_offset`: file was truncated in place — reset to 0.
6. Read only `size - offset` bytes via `tail -c +$((offset + 1))`.
7. Filter assistant content with jq; detect trigger words with `grep`.
8. Write new state to state file before detection result check.
9. On match: set blocked=1 in state, exit 2 with a descriptive message to stderr.

### The cascade problem

Naive grep on the raw delta fires on any line containing the trigger word —
including tool results, system messages, and crucially, Claude's own
acknowledgment of the block. This creates a cascade: every subsequent tool
call in the same turn retriggers the hook, even though the user has already
been informed.

Two mechanisms together eliminate the cascade:

**jq filtering:** Extract only assistant `text` and `thinking` blocks, ignoring
all other line types. Feedback echoes land as `tool_result` or `system` entries
and are never seen by detection.

```bash
jq -Rr 'try (fromjson
             | select(.type == "assistant")
             | .message.content[]?
             | select(.type == "text" or .type == "thinking")
             | (.text // .thinking)
             ) // empty'
```

**One-block-per-turn BLOCKED flag:** After the hook fires, `blocked=1` is
written to state. All subsequent tool calls in the same turn skip detection
immediately. The flag resets when a new `"type":"user"` entry appears in the
delta, marking the start of a new turn.

Without the BLOCKED flag alone, Claude's acknowledgment text (an assistant
entry, not tool_result) would still retrigger the hook. Both mechanisms are
needed.

### The partial-line problem and sentinel solution

When the hook fires, the transcript producer may be mid-write: the last line
in the delta could be a partial JSON object. This creates a permanent miss:

1. jq's `try/empty` silently skips the malformed partial line.
2. The offset advances past those partial bytes.
3. When the line completes, its remaining bytes appear after the stored offset
   and are never re-read — the detection window is permanently missed.

`tail -c +N` cannot distinguish "complete" from "partial" because bash's
`$()` command substitution strips trailing newlines. A delta ending in `\n`
(complete) and one ending without (partial) are indistinguishable after `$()`.

**Sentinel approach:** Append a sentinel byte `X` in the same subshell, before
`$()` can strip anything:

```bash
DELTA_RAW=$(tail -c +$(( START + 1 )) "$TRANSCRIPT"; printf X)
DELTA="${DELTA_RAW%X}"
```

Now `${DELTA_RAW: -2:1}` (second-to-last char, before the sentinel) is:
- `\n` if the original ended with a newline (complete last line)
- any other char if the original ended mid-line (partial write)

When partial, compute SAFE_SIZE by trimming everything from the last `\n` to
end, giving the position of the last complete line. The next hook call
re-reads from there once the line is fully written.

```bash
SAFE_SIZE=$C_SIZE
if [[ -n "$DELTA" ]] && [[ "${DELTA_RAW: -2:1}" != $'\n' ]]; then
    TRIMMED="${DELTA%$'\n'*}"
    if [[ "$TRIMMED" != "$DELTA" ]]; then
        SAFE_SIZE=$(( START + $(printf '%s' "$TRIMMED" | wc -c) + 1 ))
    else
        SAFE_SIZE=$START
    fi
fi
```

State is written to SAFE_SIZE before detection. jq still silently skips the
partial line via `try/empty` in this invocation, but the next call will
re-read it complete and detect the trigger word.

### jq failure fallback

If jq itself fails (crash, binary error), the hook falls back to raw grep on
the full delta. This loses assistant-only isolation (tool results and system
entries become visible to detection) but guarantees no silent miss — the turn
is blocked rather than skipped.

```bash
JQ_OUT=""
JQ_EXIT=0
if [[ -n "$DELTA" ]]; then
    JQ_OUT=$(echo "$DELTA" \
        | jq -Rr '...' 2>/dev/null) || JQ_EXIT=$?
fi

if (( JQ_EXIT != 0 )); then
    HAYSTACK="$DELTA"   # jq failed -- fall back to raw delta
else
    HAYSTACK="$JQ_OUT"
fi
```

### Dependency guards

Missing `jq` is detected at startup before any state is touched. The hook
exits 1 (non-blocking) with a loud diagnostic message. This ensures a missing
binary causes no side effects on the state file.

```bash
if ! command -v jq &>/dev/null; then
    printf 'simplicity-guard: jq not found -- hook inactive.\n' >&2
    exit 1
fi
```

`grep` is a POSIX baseline and assumed present; no guard is needed.

### Normal operation — no manual state management

In normal use, the BLOCKED flag makes manual state file deletion unnecessary:

1. Hook fires on first trigger word → blocked=1 written to state, exit 2.
2. User sees the structured question. Claude acknowledges.
3. Claude's acknowledgment contains the trigger word → hook reads delta, finds
   blocked=1, exits 0 immediately.
4. All subsequent tool calls in the same turn → same skip.
5. User replies → `"type":"user"` appears in delta → blocked resets to 0.
6. New turn → detection active again.

Manual deletion was needed during development only because trigger words were
deliberately typed in explanatory prose before calling tools in the same turn.

## Failure modes addressed

| Failure mode | Naive approach | This solution |
|---|---|---|
| Append-only growth | Re-reads all prior turns | Only reads new bytes |
| File truncation in place | Seeks past EOF, silent gap | `size < offset` → reset to 0 |
| File rotation / replacement | Wrong offset into new file | Inode change → reset to 0 |
| Process restart / reboot | `/tmp` state lost, re-scans from 0 | State co-located with transcript, survives reboot |
| `tail -1` catches wrong type | Misses assistant turn if last line is `system` | Reads full delta, all line types visible |
| Duplicate block on retry | Re-scans same delta | Offset written before grep, delta skipped |
| Cascade blocking | Retriggers on every tool call after first block | jq assistant-only filtering + BLOCKED flag |
| Partial-line permanent miss | jq skips partial, offset advances past it forever | Sentinel approach backs up to last complete newline |
| jq crash | Hook silent-fails | Falls back to raw grep on delta |
| Missing jq | Hook silent-fails | exit 1 with diagnostic, no state touched |

## Explicit remaining failure modes

1. **Copytruncate rotation**: content replaced before the delta is read.
   Unavoidable without a file lock held across the stat/read window. Claude
   Code does not rotate transcripts this way in practice.

2. **Concurrent hook invocations**: two simultaneous PreToolUse hooks for the
   same session would race on the state file. Claude Code runs hooks serially
   per event in the current implementation; this is not a concern in practice.

3. **Word in tool arguments or file content**: if the trigger word appears in
   a tool argument being written, the jq filter isolates this to assistant
   `text`/`thinking` blocks only — tool arguments live in `tool_use` blocks
   and are excluded from `HAYSTACK`.

4. **Crash mid-run**: state is written to SAFE_SIZE before detection. A kill
   between state write and grep result check means the delta is not re-scanned.
   One missed detection window on crash; no duplicate block signals.

## Hook registration

In `~/.claude/settings.json`:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "~/.claude/hooks/simplicity-guard.sh"
          }
        ]
      }
    ]
  }
}
```

Empty `matcher` matches all tools. The hook fires on every tool call in
every session.

To temporarily disable without removing the registration, add `"disableAllHooks": true`
to `settings.json`. This is a valid schema field that suppresses all hooks
without disturbing the registration block.

## Definition of done

- [x] `hooks/simplicity-guard.sh` written and executable (in repo)
- [x] Symlinked: `~/.claude/hooks/simplicity-guard.sh`
- [x] Hook registered under `PreToolUse` in `~/.claude/settings.json`
- [x] State files created at `$TRANSCRIPT_PATH.simplecheck.state`
- [x] Verified: hook fires and blocks when "simple" appears in Claude's text
- [x] Verified: hook does not re-scan prior turns across multiple tool calls
- [x] Verified: state survives a session restart (file persists, offset correct)
- [x] Cascade blocking eliminated via jq + BLOCKED flag
- [x] Partial-line miss eliminated via sentinel approach
- [x] jq fallback to raw grep on jq failure
- [x] Dependency guard on jq (fail loudly, no state side effects)
- [x] User interaction confirmed: Claude relays block reason, user can redirect
