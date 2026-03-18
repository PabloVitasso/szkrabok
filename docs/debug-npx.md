# Debugging npx postinstall failures

## One-shot deterministic probe

```bash
npx --yes --loglevel verbose @pablovitasso/szkrabok 2>&1 | tee /tmp/sz.log
grep -E "postinstall|patch-package|ERR|code:" /tmp/sz.log
```

Preserves lifecycle stdout, Arborist resolver decisions, and hoisting graph in a single run. Check this before anything else.

---

## Root-cause-first diagnostics

### 1. Is resolution correct?

The patching model is only valid if `playwright-core` resolves *within* the ephemeral npx tree, not from a global prefix or `NODE_PATH` escape:

```bash
npx --yes node -e "console.log(require.resolve('playwright-core'))"
```

- Path inside `~/.npm/_npx/<hash>/` → resolution is correct, proceed to step 2
- Path outside (e.g. global prefix, home `node_modules`) → **patching model is invalid by design**; `apply-patches.js` `npmRoot` bound will reject it

### 2. Is `playwright-core` actually present at patch time?

npx uses Arborist reification, which differs from `npm install --prefix` hoisting. Optional dependencies may be pruned, and the write-flush timing differs. Verify the tree is complete before assuming lifecycle ordering:

```bash
TMPDIR=$(mktemp -d)
npm install --ignore-scripts @pablovitasso/szkrabok --prefix $TMPDIR 2>/dev/null
ls $TMPDIR/node_modules/playwright-core 2>/dev/null || \
  ls $TMPDIR/node_modules/@pablovitasso/szkrabok/node_modules/playwright-core 2>/dev/null || \
  echo "NOT FOUND — tree incomplete or pruned"
```

### 3. Run apply-patches.js in isolation

```bash
node $TMPDIR/node_modules/@pablovitasso/szkrabok/scripts/apply-patches.js
```

Prints every resolution decision (`pkgDir`, `npmRoot`, `require.resolve` result, `targetRoot`, `patchDir`). **Caveat:** this does not replicate lifecycle env-vars (`INIT_CWD`, `npm_lifecycle_*`, etc.), so it rules out code bugs but not env-var-dependent branches.

### 4. Reproduce lifecycle env exactly

If step 3 passes but npx still fails, the divergence is in the lifecycle environment. Capture it:

```bash
# Add to postinstall temporarily:
# env > /tmp/postinstall-env.txt
```

Then compare `INIT_CWD`, `NODE_PATH`, `npm_config_prefix` between npx and `npm install --prefix`.

---

## Known failure signatures

| Log signal | Root cause |
|-----------|------------|
| `playwright-core not found within the npm install tree` | Resolution escaped `npmRoot` bound — check step 1 |
| `Patch file found ... not present at node_modules/playwright-core` | Correct root computed but playwright-core not hoisted there; npx hoisting differs from regular install |
| All 7 FAIL in verify | Patches applied to wrong tree or not applied at all |
| Only `utilityScriptSource.js` FAIL | Pre-1.0.28 bug — `patch-package` called without `--patch-dir` |
| Exit 1, zero postinstall output in log | npm lifecycle buffering; use `--loglevel verbose` + `tee` (step above) |
| ETIMEDOUT | Network drop; retry — but also check for partial tarball corruption in `~/.npm/_cacache` |

---

## Structural notes

- `--foreground-scripts` does **not** reproduce Arborist's ephemeral reification topology; use it only to surface stdout, not to validate patching paths
- `~/.npm/_logs` newest file is not guaranteed to be the failing npx run when concurrent npm operations exist
- `_npx` cache emptiness after failure is expected (Arborist rolls back); absence of cache entry is not itself diagnostic
- Patch marker staleness (upstream Playwright regenerating files mid-version) is detectable by diffing `patches/playwright-core+<ver>.patch` against a clean install of the same tarball hash
