# npm Publishing Plan

Package name: `@pablovitasso/szkrabok`
Mirrors GitHub: `github.com/PabloVitasso/szkrabok`

## Architecture decision: single package

Runtime (`packages/runtime/`) is not published separately.
Exposed as subpath exports of the main package:

```json
"exports": {
  ".":         "./src/index.js",
  "./runtime": "./packages/runtime/index.js"
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

Eliminates: separate runtime publish, GitHub release tarballs, RUNTIME_RELEASES map.

---

## Pre-publish checklist

1. ✅ **Package name** — `"name": "@pablovitasso/szkrabok"` in root `package.json`

2. ✅ **Subpath exports** — add `exports` map (see above)

3. ✅ **`files` array** — templates live under `src/tools/templates/` so covered by `"src"`, but list explicitly for clarity:
   ```json
   "files": ["src", "packages/runtime", "packages/mcp-client", "scripts", "README.md"]
   ```
   Verify on dry run: templates present, `packages/runtime/node_modules` absent.
   Excludes: `tests/`, `sessions/`, `dist/`, `.github/`, `docs/`, `config/`, `packages/extension/`, `packages/playwright-mcp/`

4. ✅ **Shebang** — `src/index.js` must start with `#!/usr/bin/env node`

5. ✅ **scaffold.js** — replace `RUNTIME_RELEASES` map with version read from own `package.json`:
   ```js
   // type:module — use readFileSync, not require()
   import { readFileSync } from 'node:fs';
   const { version } = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url)));
   // in mergePackageJson:
   dependencies: { '@pablovitasso/szkrabok': `^${version}` }
   ```
   Scaffolded project is always pinned to the CLI version that created it.

6. ✅ **Templates** — update `automation/fixtures.js` and `example.mcp.spec.js` imports:
   ```js
   import { launch, connect } from '@pablovitasso/szkrabok/runtime';
   import { mcpConnect }      from '@pablovitasso/szkrabok/client';
   ```

7. ✅ **Browser story** — `findChromiumPath()` already handles priority chain:
   - TOML `executablePath` (any custom binary, e.g. Ungoogled Chromium)
   - Playwright cache (`~/.cache/ms-playwright/chromium-*`)
   - System paths (`/usr/bin/chromium`, `/usr/bin/google-chrome`)
   - Falls back to Playwright default if all null
   - `szkrabok --setup` CLI flag runs `playwright install chromium` and exits
   - Postinstall (`scripts/setup.js`): creates dirs, prints hint to run `szkrabok --setup`

8. **npm login** — `npm login` (confirm username is `pablovitasso`)

---

## Publish flow

```bash
npm publish --dry-run          # audit: check templates present, no stray node_modules
npm publish --access public    # mandatory for scoped packages on first publish
```

---

## Release flow (post single-package)

```bash
npm run release:patch          # bump versions + git tag
npm publish --access public    # ships everything
```

`release:publish` script and GitHub release tarball workflow retired once on npm.
