# Debugging npx postinstall failures

## The problem

`npx @pablovitasso/szkrabok` exits 1. npm suppresses lifecycle script output by default, so nothing useful is printed — just deprecation warnings.

## Fast determination

### 1. Check what actually failed
```bash
ls -t ~/.npm/_logs/*.log | head -1 | xargs grep "postinstall.*code\|error command"
```
Look for `{ code: 1 }` on the postinstall line.

### 2. See the postinstall output (suppressed by default)
Install to a temp dir with `--foreground-scripts`:
```bash
TMPDIR=$(mktemp -d)
npm install @pablovitasso/szkrabok --prefix $TMPDIR --foreground-scripts 2>&1 | tail -30
```
This shows what `apply-patches.js` and `verify-playwright-patches.js` print.

### 3. Run apply-patches directly (fastest)
```bash
# --ignore-scripts to get the files without running postinstall
TMPDIR=$(mktemp -d)
npm install --ignore-scripts @pablovitasso/szkrabok --prefix $TMPDIR 2>/dev/null
node $TMPDIR/node_modules/@pablovitasso/szkrabok/scripts/apply-patches.js
```
apply-patches.js prints all path resolution decisions:
- `pkgDir` — where the package landed
- `npmRoot` — computed install root (used as bound for playwright-core resolution)
- `require.resolve found` — which playwright-core will be patched
- `targetRoot` / `patchDir` — what patch-package sees

### 4. Check the npx cache
```bash
ls ~/.npm/_npx/
# empty or sparse = install is being rolled back (postinstall failed)
# has node_modules = install succeeded
```

## Known failure modes

| Symptom | Cause |
|---------|-------|
| `playwright-core not found within the npm install tree` | `require.resolve` escaped the install root (e.g. global install visible above); or install was incomplete |
| `patch-package finished with 1 error(s)` + all FAIL | Patches applied to wrong playwright-core (version mismatch) |
| `FAIL lib/generated/utilityScriptSource.js` only | patch-package applied to the correct root but patches/ not found (pre-1.0.28 bug: `patch-package` called without `--patch-dir`) |
| Exit 1, no output, npx cache stays empty | Postinstall fails before any console output; run step 2 or 3 above |
| ETIMEDOUT during install | Network drop mid-install; retry |

## Key files

- `scripts/apply-patches.js` — resolves playwright-core and runs patch-package
- `scripts/verify-playwright-patches.js` — checks 7 marker strings post-patch
- `scripts/postinstall.js` — runs after patching (browser setup etc.)
