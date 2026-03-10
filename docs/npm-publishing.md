# npm Publishing Plan

Package name: `@pablovitasso/szkrabok`
Mirrors GitHub: `github.com/PabloVitasso/szkrabok`

## Pre-publish checklist

1. **Shebang** — `src/index.js` must start with `#!/usr/bin/env node`
2. **`files` array** — add to `package.json` to exclude dev artifacts:
   ```json
   "files": ["src", "scripts", "README.md"]
   ```
   Excludes: `tests/`, `sessions/`, `dist/`, `.github/`, `docs/`, `config/`, `automation/`
3. **Package name** — change in `package.json`:
   ```json
   "name": "@pablovitasso/szkrabok"
   ```
4. **Browser story** — audit `packages/runtime/launch.js` to determine what binary is required and whether a postinstall browser-install step is needed
5. **npm login** — `npm login` (confirm username is `pablovitasso`)

## Publish flow

```bash
npm publish --dry-run          # inspect what gets uploaded
npm publish --access public    # scoped packages require --access public
```

## Open questions before publishing

- Does `launch.js` use standard Playwright chromium or Ungoogled Chromium?
  - If standard: `postinstall` can run `playwright install chromium`
  - If Ungoogled: document manual setup, or add `szkrabok setup` CLI command
- Should `@szkrabok/runtime` also be published to npm eventually?
  - If yes: simplifies scaffolded project `package.json` (no tarball URL needed)
  - For now: GitHub releases tarball approach stands

## Release sync requirement

After each `npm publish`, the scaffold URL in `src/tools/scaffold.js` (`RUNTIME_RELEASES`) must also be updated if the runtime version changed.
