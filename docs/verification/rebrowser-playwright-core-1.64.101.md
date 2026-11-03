# Verification: rebrowser-playwright-core@1.64.101

- Date: 2026-10-31
- Candidate: `rebrowser-playwright-core@1.64.101`
- Upstream base: `playwright-core@1.64.1` — claimed base derived from the version scheme (`1.64.1xx` ↔ upstream `1.64.1`) and the package description; no `package.json` field declares it. The clean-room reproduce below is the proof of the base.
- Patches: `rebrowser-patches@1.1.2`, patch set `1.64.1 (lib)` (pinned, not `@latest`)

## Method (procedure V, main plan)

1. Clean room: `npm install playwright-core@1.64.1 --no-save` in an empty dir;
   `npx rebrowser-patches@1.1.2 patch --packageName playwright-core` → applied;
   `check` → patched.
2. Extracted the published tarball (`npm pack rebrowser-playwright-core@1.64.101`).
3. `diff -ruN` clean-room tree vs published tree, excluding `package.json`, `README.md`:
   **empty** (exit 0).
4. File-hash diff, identical relative paths (`cd` into each tree, `find .`), same
   exclusion whitelist: **empty** (exit 0).

## Result

**Bit-identical after excluding metadata (whitelist: `package.json`, `README.md` only).**
The published package is exactly official `playwright-core@1.64.1` + the public
`rebrowser-patches@1.1.2` lib patch. No other changes.

## Evidence

- Tarball sha512 (base64): `yw9m3HJFcsdnMRIDNEpoNVrC7Rl7oUu7PcttdG7s1EeImea0VvnOJ2i2ropECSQGVx6kthO5901fqlYnXS8ZJg==`
- npm `dist.integrity`: `sha512-yw9m3HJFcsdnMRIDNEpoNVrC7Rl7oUu7PcttdG7s1EeImea0VvnOJ2i2ropECSQGVx6kthO5901fqlYnXS8ZJg==` — **match**
- Local vs published file hashes: **match**
- Whitelist diffs (expected metadata only): `package.json` (name, version, description, keywords, repository, bugs, homepage, author, …), `README.md` (rewritten)
- Marker counts in the published `lib/coreBundle.js` (absent in stock upstream):
  `__re__emitExecutionContext` ×3, `getExecutionContext` ×3, `rebrowserUtilityScriptName` ×5,
  `REBROWSER_PATCHES_RUNTIME_FIX_MODE` ×13
- `szkrabok:greasy-brands` blocks in the drop-in: **0** — correct; the greasy-brands
  block is szkrabok's own patch, applied separately at install (verified against the
  repo's own core separately).

## Reproduce

```bash
mkdir /tmp/verify-rebrowser && cd /tmp/verify-rebrowser
npm init -y && npm install playwright-core@1.64.1 --no-save
npx rebrowser-patches@1.1.2 patch --packageName playwright-core
npx rebrowser-patches@1.1.2 check --packageName playwright-core
npm pack rebrowser-playwright-core@1.64.101 && tar -xzf rebrowser-playwright-core-1.64.101.tgz
diff -ruN node_modules/playwright-core package/ --exclude=package.json --exclude=README.md
openssl dgst -sha512 -binary rebrowser-playwright-core-1.64.101.tgz | base64   # vs npm dist.integrity
```
