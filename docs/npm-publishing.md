# npm Publishing Plan

Package name: `@pablovitasso/szkrabok`
Mirrors GitHub: `github.com/PabloVitasso/szkrabok`

## Architecture decision: single package

Runtime (`packages/runtime/`) is not published separately.
It is exposed as a subpath export of the main package:

```json
"exports": {
  ".":         "./src/index.js",
  "./runtime": "./packages/runtime/index.js",
  "./client":  "./packages/mcp-client/index.js"
}
```

Scaffolded projects declare one dependency:
```json
"@pablovitasso/szkrabok": "^1.0.9"
```

Fixtures import via subpath:
```js
import { launch, connect } from '@pablovitasso/szkrabok/runtime';
```

This eliminates: separate runtime publish, GitHub release tarballs, RUNTIME_RELEASES map.

---

## Pre-publish checklist

1. **Package name** — `package.json`: `"name": "@pablovitasso/szkrabok"`
2. **Subpath exports** — add `exports` map to `package.json` (see above)
3. **`files` array** — include runtime and mcp-client source:
   ```json
   "files": ["src", "packages/runtime", "packages/mcp-client", "scripts", "README.md"]
   ```
   Excludes: `tests/`, `sessions/`, `dist/`, `.github/`, `docs/`, `config/`, `packages/extension/`, `packages/playwright-mcp/`
4. **Shebang** — `src/index.js` must start with `#!/usr/bin/env node`
5. **scaffold.js** — simplify `mergePackageJson`: replace tarball URL with `"^x.y.z"` semver ref, drop `RUNTIME_RELEASES` map
6. **Templates** — update `automation/fixtures.js` and `example.mcp.spec.js` imports to use `@pablovitasso/szkrabok/runtime`
7. **Browser story** — `findChromiumPath()` already handles priority chain:
   - TOML `executablePath` (Ungoogled Chromium or any custom binary)
   - Playwright cache (`~/.cache/ms-playwright/chromium-*`)
   - System paths (`/usr/bin/chromium`, `/usr/bin/google-chrome`)
   - Falls back to Playwright default if all null
   - Postinstall should run `playwright install chromium` as a baseline guarantee
8. **npm login** — `npm login` (confirm username is `pablovitasso`)

---

## Publish flow

```bash
npm publish --dry-run          # inspect what gets uploaded
npm publish --access public    # required for scoped packages
```

---

## Release flow (simplified post single-package)

```bash
npm run release:patch          # bump versions, pack (pack becomes optional/dev-only)
npm publish --access public    # one command, ships everything
```

`release:publish` script and GitHub release tarball workflow can be retired once on npm.
`RUNTIME_RELEASES` in `scaffold.js` is removed — scaffold references semver instead.
