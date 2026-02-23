# launchPersistentContext + stealth evasion timing issue

## Symptom

Stealth evasions that use `onPageCreated` hooks do not apply to the initial
page of a `launchPersistentContext` session:

| Evasion | Property | Expected | Actual |
|---|---|---|---|
| `user-agent-override` | `navigator.userAgentData` | spoofed brands/platform | `null` |
| `user-agent-override` | `navigator.platform` | `Win32` | `Linux x86_64` |
| `navigator.hardwareConcurrency` | `navigator.hardwareConcurrency` | `4` | real value |
| `webgl.vendor` | WebGL VENDOR/RENDERER | `Intel Inc.` | real GPU |
| `navigator.languages` | `navigator.languages` | `["en-US","en"]` | `["en-US"]` |

Evasions without `onPageCreated` (e.g. `navigator.webdriver`, `navigator.plugins`,
`chrome.*`) work correctly.

## Root cause

`launchPersistentContext` creates a context **and** its initial page atomically.
playwright-extra's plugin hooks fire after the browser object is returned, so
`onPageCreated` never fires for that first page — it already exists.

With `launch()` + `newPage()`, hooks are registered before the page is created,
so evasions apply correctly.

Upstream issues:
- puppeteer-extra [#6](https://github.com/berstend/puppeteer-extra/issues/6) — target creation events triggered too late
- puppeteer-extra [#323](https://github.com/berstend/puppeteer-extra/issues/323) — onPageCreated hooks should be synchronous
- playwright [#24029](https://github.com/microsoft/playwright/issues/24029) — context.addInitScript not executed

## Workaround (researched, not yet applied)

Navigating to `about:blank` immediately after `launchPersistentContext` reliably
triggers the plugin hooks before the first real navigation:

```js
const context = await pw.launchPersistentContext(userDataDir, launchOptions);
const page = context.pages()[0];
await page.goto('about:blank'); // triggers onPageCreated hooks
// evasions now applied — navigate to real target
```

Documented fix from puppeteer-extra issue #6. Adds no noticeable delay.

## Affected file

`src/upstream/wrapper.js` — `launchPersistentContext()`

## Impact on rebrowser-check

`useragent` check fails because `navigator.userAgentData.brands` does not include
`Google Chrome` — set by the `user-agent-override` evasion via CDP
`Network.setUserAgentOverride`, which only runs in `onPageCreated`.

`mainWorldExecution` and `exposeFunctionLeak` are separate pre-existing issues
unrelated to this bug.
