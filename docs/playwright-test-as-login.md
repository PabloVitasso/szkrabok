# Running Playwright Login Scripts and Multi-File Tests via szkrabok

## The Core Concept

A standard Playwright test case looks like this:

```typescript
import { test, expect } from '@playwright/test';

test('log in to ABC system', async ({ page }) => {
  await page.goto('https://abc.example.com/login');
  await page.getByLabel('Username').fill('myuser');
  await page.getByLabel('Password').fill('mypass');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL('**/dashboard');
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
});
```

The `browser.run_code` tool in szkrabok accepts an async function with exactly this signature:

```
async (page) => { ... }
```

This is not a coincidence - it is the same `page` object from the Playwright API. The body of
your test IS the function you pass to `run_code`. The scaffolding (`test()`, `expect`, imports)
is what differs between the two contexts.

**What this means**: you can write login logic once, run it as a standalone Playwright test
during development and debugging, then execute the same logic via `browser.run_code` to
produce a persisted szkrabok session that is already logged in.


## What Works in run_code

`run_code` evals the function string and calls it with the real Playwright `page` object:

```javascript
// Inside playwright_mcp.js
const fn = eval(`(${code})`)
const result = await fn(session.page)
```

Everything available on the `page` object works:

| API | Example |
|-----|---------|
| Navigation | `page.goto(url)`, `page.waitForURL('**/dashboard')` |
| CSS selectors | `page.locator('#username').fill('user')` |
| Role selectors | `page.getByRole('button', { name: 'Sign in' }).click()` |
| Label selectors | `page.getByLabel('Password').fill('secret')` |
| Text selectors | `page.getByText('Welcome').waitFor({ state: 'visible' })` |
| Wait conditions | `page.waitForSelector('.spinner', { state: 'hidden' })` |
| Load state | `page.waitForLoadState('networkidle')` |
| Visibility check | `page.locator('.user-menu').isVisible()` |
| Context access | `page.context().storageState()` |
| Keyboard | `page.keyboard.press('Enter')` |
| Evaluate JS | `page.evaluate(() => document.title)` |

**What does NOT work** (not available inside the eval'd string):

- `import` / `require` statements
- `expect` from `@playwright/test` (use manual throws or return values instead)
- `test()` wrapper
- Any module-level variables from outside the string


## The Portable Script Pattern

The key is to separate the action logic from the test scaffolding. Structure your login script
so the core function can live in both worlds.

### File: `scripts/login-abc.js`

```javascript
/**
 * Login script for ABC system.
 *
 * Dual-use: run standalone with Playwright, or pass to browser.run_code.
 * The loginAbc function is the portable unit - no imports, no expect.
 */

async function loginAbc(page, { username, password } = {}) {
  const user = username || process.env.ABC_USER || 'demo';
  const pass = password || process.env.ABC_PASS || 'demo123';

  await page.goto('https://abc.example.com/login');
  await page.waitForSelector('#login-form', { state: 'visible' });

  await page.getByLabel('Username').fill(user);
  await page.getByLabel('Password').fill(pass);
  await page.getByRole('button', { name: 'Sign in' }).click();

  // Wait for redirect to dashboard
  await page.waitForURL('**/dashboard', { timeout: 15000 });

  // Verify login succeeded - throw instead of expect() for portability
  const heading = page.getByRole('heading', { name: 'Dashboard' });
  const visible = await heading.isVisible();
  if (!visible) {
    throw new Error('Login failed: Dashboard heading not visible after redirect');
  }

  return { success: true, url: page.url() };
}

// --- Playwright test wrapper (only used when running with `playwright test`) ---
// This block is NOT included when pasting into run_code

if (typeof module !== 'undefined') {
  module.exports = { loginAbc };
}
```

### Playwright test file: `tests/login-abc.spec.ts`

```typescript
import { test } from '@playwright/test';
// The function is imported - not copy-pasted
const { loginAbc } = require('../scripts/login-abc.js');

test('log in to ABC system', async ({ page }) => {
  const result = await loginAbc(page, {
    username: process.env.ABC_USER,
    password: process.env.ABC_PASS,
  });
  console.log('Logged in, URL:', result.url);
});
```

Run during development:
```bash
npx playwright test tests/login-abc.spec.ts --headed
```

### Using the same script via browser.run_code

Paste only the function body (no imports, no module.exports block):

```javascript
browser.run_code({
  id: "abc-session",
  code: `async (page) => {
    const user = 'myuser';
    const pass = 'mypass';

    await page.goto('https://abc.example.com/login');
    await page.waitForSelector('#login-form', { state: 'visible' });

    await page.getByLabel('Username').fill(user);
    await page.getByLabel('Password').fill(pass);
    await page.getByRole('button', { name: 'Sign in' }).click();

    await page.waitForURL('**/dashboard', { timeout: 15000 });

    const visible = await page.getByRole('heading', { name: 'Dashboard' }).isVisible();
    if (!visible) throw new Error('Login failed: Dashboard heading not visible');

    return { success: true, url: page.url() };
  }`
})
```

After this call returns, the szkrabok session `abc-session` contains the logged-in browser
state. Close (or just leave) the session and re-open it later - you are still logged in.


## Inlining a Page Object Model

When your login logic uses a POM class, you cannot import it into the eval'd string. Instead,
inline the class definition inside the async function:

```javascript
browser.run_code({
  id: "abc-session",
  code: `async (page) => {
    // Inline POM - no imports needed
    class LoginPage {
      constructor(page) {
        this.page = page;
        this.usernameInput = page.getByLabel('Username');
        this.passwordInput = page.getByLabel('Password');
        this.submitButton = page.getByRole('button', { name: 'Sign in' });
      }

      async goto() {
        await this.page.goto('https://abc.example.com/login');
        await this.page.waitForSelector('#login-form', { state: 'visible' });
      }

      async login(username, password) {
        await this.usernameInput.fill(username);
        await this.passwordInput.fill(password);
        await this.submitButton.click();
        await this.page.waitForURL('**/dashboard', { timeout: 15000 });
      }

      async isLoggedIn() {
        return this.page.getByRole('heading', { name: 'Dashboard' }).isVisible();
      }
    }

    // Use the POM
    const loginPage = new LoginPage(page);
    await loginPage.goto();
    await loginPage.login('myuser', 'mypass');

    if (!(await loginPage.isLoggedIn())) {
      throw new Error('Login failed');
    }

    return { success: true, url: page.url() };
  }`
})
```

This pattern mirrors the official Playwright POM recommendation (from the Playwright docs):
> "Page objects simplify authoring by creating a higher-level API which suits your application
> and simplify maintenance by capturing element selectors in one place."

The difference is that in `run_code` context the class is local to the function, not imported.


## Assertions: expect() vs Manual Throws

`expect` from `@playwright/test` is not available inside `run_code`. The alternatives:

| Playwright test | run_code equivalent |
|----------------|---------------------|
| `await expect(locator).toBeVisible()` | `if (!(await locator.isVisible())) throw new Error(...)` |
| `await expect(page).toHaveURL('/dashboard')` | `await page.waitForURL('**/dashboard')` (throws on timeout) |
| `await expect(locator).toHaveText('Welcome')` | `const t = await locator.textContent(); if (!t.includes('Welcome')) throw ...` |
| `await expect(locator).toBeEnabled()` | `if (!(await locator.isEnabled())) throw new Error(...)` |

Playwright's `waitFor*` methods throw on timeout, which is often sufficient as an assertion:

```javascript
// This throws if the element does not become visible within 10 seconds
await page.waitForSelector('.dashboard-header', { state: 'visible', timeout: 10000 });
```


## Full Login + Session Persistence Flow

```
1. session.open("abc-prod")
   -> creates stealth Chromium profile at sessions/abc-prod/profile/

2. browser.run_code({ id: "abc-prod", code: `async (page) => { ...login logic... }` })
   -> executes login, cookies/localStorage written to profile dir automatically

3. session.close("abc-prod")
   -> profile dir persists on disk with logged-in state

4. (later) session.open("abc-prod")
   -> relaunches Chromium pointing at same profile dir
   -> already logged in, no re-authentication needed
```

Session data is stored as a native Chromium profile (not a JSON snapshot), so:
- Cookies are in `sessions/abc-prod/profile/Default/Cookies` (SQLite)
- localStorage/IndexedDB persist via LevelDB
- This is identical to how a real browser saves your login

If you want a portable JSON export of the session state (e.g. to transfer it), you can
extract it via `run_code` using the Playwright `storageState()` API:

```javascript
browser.run_code({
  id: "abc-prod",
  code: `async (page) => {
    // Export cookies + localStorage + IndexedDB as JSON
    const state = await page.context().storageState({ indexedDB: true });
    return state;
  }`
})
```

This returns the same JSON format as Playwright's `context.storageState()` which can be used
with `browser.newContext({ storageState: state })` in a standalone Playwright setup.


## A Proposed browser.run_script Tool

The current `browser.run_code` accepts the function as an inline string, which means:
- No syntax highlighting in editors
- No module imports
- Awkward for long scripts

A natural evolution would be a `browser.run_script` tool that accepts a file path instead:

```javascript
// Hypothetical tool - not yet implemented
browser.run_script({
  id: "abc-session",
  path: "./scripts/login-abc.mjs",
  args: { username: "myuser", password: "mypass" }
})
```

The script file would export a default async function:

```javascript
// scripts/login-abc.mjs
export default async function(page, args = {}) {
  await page.goto('https://abc.example.com/login');
  await page.getByLabel('Username').fill(args.username);
  await page.getByLabel('Password').fill(args.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL('**/dashboard');
  return { url: page.url() };
}
```

This file could also be run directly via Playwright test with a thin wrapper, achieving true
dual-use without any copy-pasting. Implementing this would require:

1. A new tool handler in `src/tools/playwright_mcp.js` that reads the file from disk
2. Dynamic `import()` of the module (works natively in ESM)
3. Calling the default export with `(session.page, args)`

This is architecturally straightforward since szkrabok is already ESM (`"type": "module"`
in package.json).


## Summary

| Question | Answer |
|----------|--------|
| Can run_code execute a playwright test body? | Yes - the `async (page) => {}` signature is identical |
| Can you use page.locator(), getByRole(), etc.? | Yes - full Playwright page API |
| Can you use expect() from @playwright/test? | No - use waitFor* or manual throws |
| Can you import modules? | No - inline everything or use self-contained functions |
| Can you use POM classes? | Yes - define them inline inside the function |
| Does the session persist after run_code? | Yes - native Chromium profile, automatically saved |
| Can you run the same logic as a standalone test? | Yes - wrap the function in test() with a thin import |
| Is there a better approach for file-based scripts? | Yes - browser.run_file (implemented) |

---

## Part 2: Running Real Multi-File Playwright Tests → Persisted szkrabok Session

This section researches all avenues for writing a classic, properly structured Playwright test
suite (page objects, utils, fixtures across multiple files) and having the resulting logged-in
browser state become a szkrabok session.

---

### How szkrabok Opens a Browser vs "Pure" Playwright

Understanding the difference is essential before picking an approach.

**szkrabok** (`src/upstream/wrapper.js`):

```javascript
// Always uses launchPersistentContext - ties browser to a userDataDir on disk
return pw.launchPersistentContext(userDataDir, launchOptions)
// userDataDir = sessions/{id}/profile/
```

- Uses `launchPersistentContext` - browser IS the context, no separate `browser.newContext()`
- Profile directory persists on disk automatically
- Does NOT expose a CDP port or Playwright protocol endpoint by default
- stealth plugin patched in via `playwright-extra`
- Chromium binary from `~/.cache/ms-playwright/chromium-*/` or system fallback

**Pure Playwright test runner** (`npx playwright test`):

```javascript
// Test runner manages its own browser lifecycle
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext(); // isolated, temp dir
const page = await context.newPage();
```

- Spawns its own Chromium process with its own temp user data dir
- Communicates over Playwright's internal protocol (not CDP)
- `expect()`, fixtures, `test()` all available
- Full import system - POM classes, utils, etc.

**The gap**: A `npx playwright test` process and a szkrabok session are two separate Chromium
processes. They cannot directly share a live browser. The session state must be exchanged via
disk (profile dir or storageState JSON) or via a live connection protocol (CDP).

---

### Avenue A: Shared userDataDir  *(recommended - zero changes to szkrabok)*

This is the most elegant approach. szkrabok and Playwright both support
`launchPersistentContext(userDataDir)`. Point them at the **same directory**.

```
szkrabok session "abc-prod"  →  sessions/abc-prod/profile/
Playwright test              →  launchPersistentContext('sessions/abc-prod/profile/')
```

**Important constraint from Playwright docs**: Chromium does not allow two processes to use
the same userDataDir simultaneously. The workflow is therefore sequential:

```
1. Playwright test runs  (opens Chromium at sessions/abc-prod/profile/)
   └── performs full login with POM classes, expect(), imports, etc.
   └── context.close()  →  profile written to disk with logged-in cookies

2. szkrabok session.open("abc-prod")
   └── launchPersistentContext('sessions/abc-prod/profile/')
   └── already logged in - no re-authentication needed
```

**Implementation: standalone login script**

```typescript
// scripts/login-abc.ts
// Classic Playwright - full imports, full expect, POM, utils, everything
import { chromium } from 'playwright';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/DashboardPage';
import { expect } from '@playwright/test';
import path from 'path';

const SZKRABOK_SESSIONS = path.resolve('./sessions');
const SESSION_ID = 'abc-prod';
const USER_DATA_DIR = path.join(SZKRABOK_SESSIONS, SESSION_ID, 'profile');

(async () => {
  // Matches szkrabok's own Chromium binary
  const context = await chromium.launchPersistentContext(USER_DATA_DIR, {
    headless: false, // headed for login - see what happens
    viewport: { width: 1280, height: 800 },
    locale: 'en-US',
    timezoneId: 'America/New_York',
  });

  const page = await context.newPage();
  const loginPage = new LoginPage(page);
  const dashboardPage = new DashboardPage(page);

  await loginPage.goto();
  await loginPage.login(process.env.ABC_USER!, process.env.ABC_PASS!);

  // Full expect() available here
  await expect(dashboardPage.heading).toBeVisible();
  await expect(page).toHaveURL(/dashboard/);

  console.log('Login successful. Session saved to:', USER_DATA_DIR);
  await context.close(); // closes browser, profile dir remains on disk
})();
```

Run it once:
```bash
ABC_USER=myuser ABC_PASS=mypass npx tsx scripts/login-abc.ts
```

Now in szkrabok:
```javascript
session.open({ id: "abc-prod" })  // already logged in
```

**As a Playwright test** (with `playwright test` runner):

```typescript
// tests/setup/login-abc.setup.ts
import { test as setup } from '@playwright/test';
import { LoginPage } from '../pages/LoginPage';
import path from 'path';

const USER_DATA_DIR = path.resolve('./sessions/abc-prod/profile');

// This runs as a "setup" project in playwright.config.ts
setup('bootstrap abc-prod szkrabok session', async () => {
  // Can't use the normal { page } fixture here because we need a specific userDataDir
  // Use Playwright library API directly inside a setup test
  const { chromium } = await import('playwright');
  const context = await chromium.launchPersistentContext(USER_DATA_DIR, {
    headless: true,
    viewport: { width: 1280, height: 800 },
  });

  const page = await context.newPage();
  const loginPage = new LoginPage(page);
  await loginPage.goto();
  await loginPage.login(process.env.ABC_USER!, process.env.ABC_PASS!);
  await page.waitForURL(/dashboard/);

  await context.close();
});
```

```typescript
// playwright.config.ts - login setup project
import { defineConfig } from '@playwright/test';
import path from 'path';

export default defineConfig({
  projects: [
    {
      name: 'szkrabok-setup',
      testMatch: '**/setup/*.setup.ts',
    },
    {
      name: 'tests',
      dependencies: ['szkrabok-setup'],
      use: { /* your test config */ },
    },
  ],
});
```

**Pros of Avenue A:**
- Zero changes to szkrabok
- Full Playwright API: `expect()`, POM, imports, fixtures, utils
- Perfect separation: Playwright does the login, szkrabok does the session management
- Works with any multi-file test structure

**Cons:**
- Must use the same Chromium binary version (or accept minor profile migration)
- Cannot run login script and szkrabok session simultaneously on same profile
- Stealth plugin not applied during the login step (mitigable by adding playwright-extra)

---

### Avenue B: CDP Bridge  *(requires small szkrabok option)*

Chromium supports a `--remote-debugging-port` flag that exposes a CDP HTTP endpoint.
Playwright can attach to a running browser via this endpoint using `connectOverCDP`.

The idea: open a szkrabok session with a CDP port exposed, then run a full Playwright test
against that live session.

```
szkrabok session "abc-prod"  (Chromium with --remote-debugging-port=9222)
       ↓  CDP  http://localhost:9222
Playwright test  chromium.connectOverCDP('http://localhost:9222')
       └── runs full test suite against live szkrabok session
       └── test closes, CDP disconnects - szkrabok session still alive and logged in
```

**How to expose the CDP port from szkrabok:**

szkrabok's `launchPersistentContext` passes through all options to Playwright. Adding `args`
with the debug port works:

```javascript
// MCP call:
session.open({
  id: "abc-prod",
  config: {
    args: ['--remote-debugging-port=9222']
  }
})
```

Currently `args` is not forwarded in `session.js` - it only forwards known config keys
(viewport, userAgent, locale, timezone, headless). This would need a small change to also
pass `args` through to `launchPersistentContext`.

Once the session exposes the port, a standalone Playwright test connects:

```typescript
// scripts/login-abc-cdp.ts
import { chromium, expect } from '@playwright/test';
import { LoginPage } from './pages/LoginPage';

(async () => {
  // Attach to the already-running szkrabok Chromium
  const browser = await chromium.connectOverCDP('http://localhost:9222');

  // szkrabok's persistent context is browser.contexts()[0]
  const context = browser.contexts()[0];
  const page = context.pages()[0];

  const loginPage = new LoginPage(page);
  await loginPage.goto();
  await loginPage.login(process.env.ABC_USER!, process.env.ABC_PASS!);

  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();

  // Disconnect - szkrabok session stays alive with logged-in state
  await browser.close(); // closes the CDP connection, NOT the browser
})();
```

**Important CDP limitation from Playwright docs:**
> "This connection is significantly lower fidelity than the Playwright protocol connection."

This means some advanced Playwright features (network interception, auto-wait internals, etc.)
may behave differently over CDP vs native Playwright protocol. Basic actions (click, fill,
navigate, waitForSelector) work fine.

**Pros of Avenue B:**
- No disk coordination needed - operates on the live session
- szkrabok session stays open while test runs; can use both simultaneously
- After test finishes, cookies are already in the szkrabok session context

**Cons:**
- Requires szkrabok to pass `args` through to `launchPersistentContext` (small change)
- CDP has lower fidelity than Playwright protocol - some features differ
- Port management needed (hardcoded or dynamic port assignment)
- Not compatible with stealth plugin (CDP exposes automation signals)

---

### Avenue C: esbuild/rollup Bundle → browser.run_code

Bundle your multi-file Playwright scripts into a single self-contained JavaScript string,
then pass it to `browser.run_code`. This keeps everything inside szkrabok's eval context.

**How bundling works:**

esbuild can take a TypeScript entry point with imports and produce a single inlined output:

```bash
# Bundle everything into one IIFE string
npx esbuild scripts/login-abc.ts \
  --bundle \
  --format=iife \
  --global-name=__loginScript \
  --platform=node \
  --external:playwright \
  --outfile=dist/login-abc.bundle.js
```

The `--external:playwright` flag prevents Playwright itself from being bundled (it is already
present in the szkrabok process). The resulting `dist/login-abc.bundle.js` contains all your
POM classes, utils, and logic inlined.

**Adapted script structure for bundling:**

```typescript
// scripts/login-abc.ts  (entry point for bundle)
import { LoginPage } from './pages/LoginPage';
import { waitForDashboard } from './utils/navigation';

// Export a function that matches run_code's expected signature
export default async function loginAbc(page: any) {
  const loginPage = new LoginPage(page);
  await loginPage.goto();
  await loginPage.login(process.env.ABC_USER!, process.env.ABC_PASS!);
  await waitForDashboard(page);
  return { success: true, url: page.url() };
}
```

After bundling, extract the function and pass it:

```javascript
// Node.js runner to produce the run_code string
import { readFileSync } from 'fs';

const bundle = readFileSync('dist/login-abc.bundle.js', 'utf8');
// The bundle exports to __loginScript.default - wrap it:
const runCodeString = `async (page) => {
  ${bundle}
  return await __loginScript.default(page);
}`;

// Then call MCP tool with runCodeString as the code argument
```

Or more simply, structure the bundle to export a runnable function and read it via
`extract.evaluate` / Node interop:

```bash
# Simpler: build as a CommonJS module, then inline
npx esbuild scripts/login-abc.ts \
  --bundle \
  --format=cjs \
  --platform=node \
  --external:playwright \
  --outfile=dist/login-abc.cjs
```

```javascript
// In browser.run_code:
code: `async (page) => {
  // Inlined bundle goes here after build step
  // (copy-paste or programmatic injection from dist/login-abc.cjs)
}`
```

**A helper script to automate this pipeline:**

```javascript
// tools/run-script.mjs
// Usage: node tools/run-script.mjs scripts/login-abc.ts abc-prod
import { execSync } from 'child_process';
import { readFileSync } from 'fs';

const [scriptPath, sessionId] = process.argv.slice(2);

// 1. Bundle
execSync(`npx esbuild ${scriptPath} --bundle --format=iife --global-name=__s --external:playwright --outfile=/tmp/szk-bundle.js`);

const bundle = readFileSync('/tmp/szk-bundle.js', 'utf8');
const code = `async (page) => { ${bundle}; return await __s.default(page); }`;

// 2. Inject into MCP call (via stdin or config)
// This depends on how you invoke MCP tools from outside Claude
console.log(JSON.stringify({ tool: 'browser.run_code', args: { id: sessionId, code } }));
```

**Pros of Avenue C:**
- Works entirely within existing szkrabok API - no changes needed
- POM classes and utils survive via bundling
- Build step is a known pattern (esbuild is extremely fast)

**Cons:**
- `expect()` from `@playwright/test` still not available (eval context limitation)
- Requires a build step before each run
- Bundled code is harder to debug
- Cannot use Playwright test fixtures (no `test()`, no fixture dependency injection)

---

### Avenue D: Playwright globalSetup as szkrabok Session Bootstrapper

Playwright's `globalSetup` runs before any tests as a plain Node.js function. It has
full access to the Playwright library API (not the test runner API). This is the pattern
the Playwright docs recommend for authentication that should be reused across tests.

Reframed: `globalSetup` is how you write "a login script that runs once and saves state."
This maps directly to the szkrabok use case.

```typescript
// global-setup.ts
import { chromium } from 'playwright';
import { LoginPage } from './pages/LoginPage';
import path from 'path';

export default async function globalSetup() {
  const userDataDir = path.resolve(
    './sessions/abc-prod/profile'
  );

  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: true,
    viewport: { width: 1280, height: 800 },
    locale: 'en-US',
    timezoneId: 'America/New_York',
  });

  const page = await context.newPage();
  const loginPage = new LoginPage(page);

  await loginPage.goto();
  await loginPage.login(process.env.ABC_USER!, process.env.ABC_PASS!);
  await page.waitForURL(/\/dashboard/);

  await context.close(); // profile saved, browser closed
  console.log('[setup] abc-prod session bootstrapped');
}
```

Run just the setup (no tests):
```bash
npx playwright test --project=setup
# or
npx tsx global-setup.ts
```

Then in szkrabok:
```javascript
session.open({ id: "abc-prod" })  // logged in
```

This is essentially Avenue A organized via Playwright's project system. It is the canonical
Playwright way to handle the "login once, reuse everywhere" pattern. From Playwright docs:

> "This approach avoids repeated logins, significantly speeding up test execution by allowing
> tests to start in an already authenticated state."

The only difference here is that "reuse" means "open in szkrabok" rather than "reuse in
subsequent playwright tests."

---

### Comparison of Avenues

| | A: Shared userDataDir | B: CDP Bridge | C: esbuild Bundle | D: globalSetup |
|---|---|---|---|---|
| szkrabok changes needed | None | `args` passthrough | None | None |
| Full Playwright API | Yes | Partial (CDP) | No (eval context) | Yes |
| `expect()` works | Yes | Yes | No | Yes |
| Multi-file POM/utils | Yes (imports) | Yes (imports) | Yes (bundled) | Yes (imports) |
| Live session access | No (sequential) | Yes | Via szkrabok | No (sequential) |
| Build step required | No | No | Yes (esbuild) | No |
| Complexity | Low | Medium | Medium | Low |
| **Recommended for** | Simple login scripts | Complex interactive auth | Existing scripts | Playwright teams |

---

### Recommended Approach: Avenue A with Avenue D structure

Write your login logic using the Playwright `globalSetup` pattern (Avenue D organization)
but pointed directly at szkrabok's userDataDir (Avenue A mechanism):

**Project structure:**

```
login-scripts/
├── pages/
│   ├── LoginPage.ts       # POM: login form
│   └── DashboardPage.ts   # POM: post-login verification
├── utils/
│   └── wait.ts            # shared wait helpers
├── sessions/
│   └── abc-prod.ts        # entry point for this session
└── playwright.config.ts   # optional: run as playwright project
```

**`sessions/abc-prod.ts`** — the entry point:

```typescript
import { chromium } from 'playwright';
import { expect } from '@playwright/test';
import { LoginPage } from '../pages/LoginPage';
import { DashboardPage } from '../pages/DashboardPage';
import path from 'path';

const SZKRABOK_ROOT = path.resolve(__dirname, '../../.');

export async function bootstrapSession(sessionId: string, creds: { user: string; pass: string }) {
  const userDataDir = path.join(SZKRABOK_ROOT, 'sessions', sessionId, 'profile');

  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: true,
    viewport: { width: 1280, height: 800 },
    locale: 'en-US',
    timezoneId: 'America/New_York',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  });

  const page = await context.newPage();

  try {
    const loginPage = new LoginPage(page);
    const dashboardPage = new DashboardPage(page);

    await loginPage.goto();
    await loginPage.login(creds.user, creds.pass);

    // Full expect() - this is NOT inside browser.run_code
    await expect(dashboardPage.heading).toBeVisible({ timeout: 15000 });
    await expect(page).toHaveURL(/dashboard/);

    console.log(`[szkrabok] Session "${sessionId}" bootstrapped. URL: ${page.url()}`);
  } finally {
    await context.close(); // saves profile, closes browser
  }
}

// CLI entry point
if (require.main === module) {
  bootstrapSession('abc-prod', {
    user: process.env.ABC_USER!,
    pass: process.env.ABC_PASS!,
  }).catch(console.error);
}
```

Run:
```bash
ABC_USER=myuser ABC_PASS=mypass npx tsx sessions/abc-prod.ts
```

Then use in szkrabok:
```javascript
session.open({ id: "abc-prod" })
// session is logged in and ready
```

This is a completely normal Playwright script. You can develop it with `--headed`, step
through it with the Playwright inspector (`PWDEBUG=1`), run it as a Playwright test project,
use full POM structure, and when it's working - the output is a szkrabok session.

---

## Part 3: Built-in Coordination Tools (Implemented)

> **Design principle**: one tool (`browser.run_file`), one file convention, unlimited named
> functions per file. Each function returns whatever JSON it wants. The MCP caller picks
> which function to run and what args to pass.

Two tools were added to szkrabok to directly solve the multi-file coordination problem.

---

### `browser.run_file` — Named export dispatch into an ESM script file

**Signature**:
```javascript
browser.run_file({ id, path, fn?, args? })
```

- `id` — szkrabok session
- `path` — path to an `.mjs` script file
- `fn` — which named export to call (default: `"default"`)
- `args` — plain object passed as second parameter; returned as `result`

The script is a real ESM module. Every export is a callable "test case". `browser.run_file`
dispatches to whichever one you name. One tool, one file, unlimited functions.

**Example: a script module with several named functions**

```javascript
// scripts/abc-system.mjs
import { LoginPage }     from './pages/LoginPage.mjs';
import { DashboardPage } from './pages/DashboardPage.mjs';
import { InvoicePage }   from './pages/InvoicePage.mjs';
import { expect }        from '@playwright/test';
import { fetchJSON }     from './utils/api.mjs';

// --- login -----------------------------------------------------------
export async function login(page, { username, password }) {
  const lp = new LoginPage(page);
  await lp.goto();
  await lp.fill(username, password);
  await lp.submit();
  await expect(page).toHaveURL(/dashboard/);
  return { ok: true, url: page.url() };
}

// --- scrape invoices -------------------------------------------------
export async function scrapeInvoices(page, { status = 'unpaid' } = {}) {
  const ip = new InvoicePage(page);
  await ip.goto();
  await ip.filterByStatus(status);
  const rows = await ip.readRows();          // returns array of objects
  return { count: rows.length, rows };
}

// --- approve first pending invoice -----------------------------------
export async function approveFirst(page, _args) {
  const ip = new InvoicePage(page);
  await ip.goto();
  const id = await ip.approveFirst();
  return { approved: id };
}

// --- query API endpoint with session cookies -------------------------
export async function apiQuery(page, { endpoint }) {
  // page.evaluate runs in browser context - uses live session cookies
  const data = await page.evaluate(async (url) => {
    const res = await fetch(url, { credentials: 'include' });
    return res.json();
  }, endpoint);
  return data;
}

// default = login (shorthand)
export default login;
```

**Calling each function via MCP**:

```javascript
// Log in
browser.run_file({ id: "abc", path: "./scripts/abc-system.mjs",
  fn: "login", args: { username: "u", password: "p" } })
// → { fn: "login", result: { ok: true, url: "https://..." }, url: "..." }

// Scrape unpaid invoices
browser.run_file({ id: "abc", path: "./scripts/abc-system.mjs",
  fn: "scrapeInvoices", args: { status: "unpaid" } })
// → { fn: "scrapeInvoices", result: { count: 4, rows: [...] }, url: "..." }

// Approve first pending
browser.run_file({ id: "abc", path: "./scripts/abc-system.mjs",
  fn: "approveFirst" })
// → { fn: "approveFirst", result: { approved: "INV-007" }, url: "..." }

// Hit an API endpoint using the session's live cookies
browser.run_file({ id: "abc", path: "./scripts/abc-system.mjs",
  fn: "apiQuery", args: { endpoint: "/api/v1/me" } })
// → { fn: "apiQuery", result: { id: 42, name: "Alice" }, url: "..." }
```

If you name a function that doesn't exist, the error tells you what is available:
```
Export "typo" not found in "...abc-system.mjs". Available exports: [login, scrapeInvoices, approveFirst, apiQuery]
```

**Implementation** (`src/tools/playwright_mcp.js`):

```javascript
export const run_file = async args => {
  const { id, path: scriptPath, fn = 'default', args: scriptArgs = {} } = args
  const session = pool.get(id)
  const absolutePath = resolve(scriptPath)

  // Cache-bust: re-reads file on every call, no need to restart szkrabok
  const mod = await import(`${absolutePath}?t=${Date.now()}`)

  const target = fn === 'default' ? mod.default : mod[fn]

  if (typeof target !== 'function') {
    const available = Object.keys(mod).filter(k => typeof mod[k] === 'function').join(', ')
    throw new Error(
      `Export "${fn}" not found or not a function in "${absolutePath}". Available exports: [${available}]`
    )
  }

  const result = await target(session.page, scriptArgs)
  return { fn, result, url: session.page.url() }
}
```

**Script contract**:
- File must be `.mjs` (or `.js` in a `"type":"module"` package)
- Each export is `async function name(page, args) { return <json> }`
- `page` is the live szkrabok session page
- Return value must be JSON-serialisable — it becomes `result` in the MCP response
- Szkrabok session stays alive after the function returns

**Dual-use: same functions as Playwright tests**

```typescript
// tests/abc-system.spec.ts
import { test, expect } from '@playwright/test';
import * as abc from '../scripts/abc-system.mjs';

test('login', async ({ page }) => {
  const r = await abc.login(page, { username: process.env.U!, password: process.env.P! });
  expect(r.ok).toBe(true);
});

test('scrape invoices', async ({ page }) => {
  // assumes page is already logged in via storageState fixture
  const r = await abc.scrapeInvoices(page, { status: 'unpaid' });
  expect(r.count).toBeGreaterThan(0);
});
```

The exact same `.mjs` file. No changes. `npx playwright test` or `browser.run_file` —
same code, both work.

---

### `session.endpoint` — Connect an external Playwright process to a live session

Returns the Playwright WebSocket endpoint of a running szkrabok session. An external script
can `connect()` to this endpoint and get a full-fidelity Playwright connection to the same
browser (not CDP — the native Playwright protocol, full fidelity).

```javascript
session.endpoint({ id: "abc-prod" })
// Returns: { sessionId: "abc-prod", wsEndpoint: "ws://127.0.0.1:XXXXX/..." }
```

An external script connects to this endpoint and runs against the live session:

```javascript
// external-script.mjs - runs outside szkrabok, connects to its browser
import { chromium } from 'playwright';
import { LoginPage } from './pages/LoginPage.mjs';
import { expect } from '@playwright/test';

const wsEndpoint = process.argv[2]; // passed from MCP result

const browser = await chromium.connect(wsEndpoint);
const context = browser.contexts()[0];   // szkrabok's persistent context
const page = context.pages()[0];          // szkrabok's active page

// Full Playwright test against the live szkrabok session
const loginPage = new LoginPage(page);
await loginPage.goto();
await loginPage.login(process.env.ABC_USER, process.env.ABC_PASS);
await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();

// Disconnect without closing - szkrabok session stays alive and logged in
await browser.close();
```

**Implementation** (`src/tools/session.js`):

```javascript
export const endpoint = async args => {
  const { id } = args
  const session = pool.get(id)

  const browser = session.context.browser()
  const wsEndpoint = browser?.wsEndpoint() || null

  return { sessionId: id, wsEndpoint }
}
```

**When to use `session.endpoint` vs `browser.run_file`**:

| | `browser.run_file` | `session.endpoint` + external connect |
|---|---|---|
| Script location | On same machine, path known to szkrabok | Anywhere - could be remote |
| Process model | Script runs inside szkrabok's Node process | Script runs in its own process |
| Session stays open | Yes - script drives szkrabok's page | Yes - szkrabok keeps context open |
| Use full POM/imports | Yes (ESM dynamic import) | Yes (own process, own imports) |
| `expect()` works | Yes | Yes |
| Playwright test runner | No - just a function | Can use `npx playwright test` |

Use `browser.run_file` when your script is a helper on the same machine.
Use `session.endpoint` when you want to run a full `npx playwright test` suite against
a szkrabok session that you keep open as the session store.

---

### Complete flow: multi-file test → persisted szkrabok session

```
1. session.open({ id: "abc-prod" })
   -> szkrabok creates stealth Chromium at sessions/abc-prod/profile/

2a. browser.run_file({ id: "abc-prod", path: "./scripts/login.mjs", args: {...} })
    -> loads real ESM module, calls default export with (page, args)
    -> full imports, POM, expect() all work
    -> session page is now logged in

   --- OR ---

2b. session.endpoint({ id: "abc-prod" }) → { wsEndpoint: "ws://..." }
    -> run: npx playwright test tests/login.spec.ts --project=connect
    -> test connects via chromium.connect(wsEndpoint), runs full suite
    -> session browser holds logged-in state

3. session.close({ id: "abc-prod" })   [or just leave open]
   -> profile saved to disk

4. session.open({ id: "abc-prod" })    [any time later]
   -> already logged in
```
