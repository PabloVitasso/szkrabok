# Feature: Chrome extension loading

## Goal

Allow users to load unpacked Chrome extensions or `.crx` files into szkrabok-managed
browser sessions, enabling automation that depends on extension-injected APIs, content
scripts, or UI panels.

---

## Background

The current launcher (`packages/runtime/launch.js`) imports only `chromium` from
Playwright and calls `chromium.launchPersistentContext()` with a fixed set of
hardcoded flags. Users cannot pass custom Chromium `args`. The `launchOptions` schema
accepted by `session_manage open` has no `args` field and no extension path fields.

Extensions require `--load-extension=<path>` and `--disable-extensions-except=<path>`
to be passed at launch time. These flags are incompatible with packed (`.crx`) files
in newer Chromium versions — unpacked extension directories are required.

Only Chromium/Chrome is supported; Firefox and WebKit are not in scope.

---

## Proposed changes

### 1. Add `args` pass-through to `launchOptions` schema

In `src/tools/registry.js`, add an optional `args` field to the `session_manage open`
schema:

```js
args: z.array(z.string()).optional()
  .describe('Extra Chromium flags passed directly to launchPersistentContext'),
```

In `packages/runtime/launch.js`, merge user `args` into the hardcoded list before
calling `launchPersistentContext`. User-supplied flags come after hardcoded ones so
the fixed invariants (CDP port, crash bubble suppression) cannot be overridden.

### 2. Add `extensions` config section to `szkrabok.config.toml`

```toml
[extensions]
# Paths to unpacked extension directories (absolute or relative to config file)
load = [
  "./extensions/my-extension",
]
```

Config loader resolves paths relative to the config file's directory and injects the
appropriate `--load-extension` and `--disable-extensions-except` flags automatically,
so users do not need to hand-craft Chromium flags.

### 3. Schema entry in `launchOptions`

Add an `extensions` field parallel to `args` for explicit per-session overrides:

```js
extensions: z.array(z.string()).optional()
  .describe('Paths to unpacked extension directories to load for this session'),
```

Session-level `extensions` merges with config-level `extensions` (union, no dedup).

---

## Stealth compatibility

The `user-data-dir` evasion is already disabled in `packages/runtime/stealth.js`
(permanent, due to persistent profile conflicts). No new evasion disables are needed.

Some stealth evasions mock `chrome.runtime` and `navigator.plugins`. Extensions that
inspect these APIs may behave unexpectedly in headless mode with stealth enabled.
This is a known limitation and does not require a code change — document it.

---

## Constraints and non-goals

- **Chromium only.** No Firefox or WebKit path exists; this feature stays Chromium-scoped.
- **Unpacked extensions only.** Packed `.crx` files are unsupported in modern Chromium
  without enterprise policy. Users must provide unpacked directories.
- **No extension install automation.** Installing from the Chrome Web Store is not
  addressed — network-fetched `.crx` install is a separate concern.
- **No extension state isolation between clones.** Extension data lives in the profile
  directory; clones inherit it as-is. Clearing extension state between clones is out of scope.
- **No `args` sanitization beyond schema typing.** Dangerous flags (e.g.
  `--remote-debugging-port`) are the user's responsibility. Document this.

---

## Definition of done

- [ ] `args: string[]` field added to `session_manage open` schema
- [ ] `packages/runtime/launch.js` merges user `args` after hardcoded flags
- [ ] `[extensions] load` config section supported; paths resolved relative to config file
- [ ] `extensions` field in `launchOptions` for per-session override
- [ ] Config-level and session-level extension lists are unioned at launch time
- [ ] Node tests: `args` pass-through covered in `config-values.test.js` or new test
- [ ] Node tests: extension path resolution covered (absolute + relative)
- [ ] Integration test: session opens with a real unpacked extension; extension API accessible
- [ ] Stealth/extension incompatibility documented in `docs/architecture.md`
- [ ] `npm run test:node` green
