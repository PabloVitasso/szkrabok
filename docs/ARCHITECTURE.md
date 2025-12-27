# SZKRABOK-PLAYWRIGHT-MCP v2.0
**Production-grade MCP browser automation with persistent sessions and stealth**

---

## 1. PURPOSE

SZKRABOK provides:

- **persistent sessions** (restore cookies, localStorage across restarts)
- **session management** (CRUD operations)
- **stealth layer** (anti-detection via playwright-extra)
- **workflow abstractions** (login, forms, scraping)
- **state tracking** (metadata, history)
- **centralized configuration** (DRY principle)

---

## 2. ARCHITECTURE

```
LLM → SZKRABOK MCP
         ↓
    Playwright (direct)
    + Stealth Plugin
         ↓
    Browser Sessions
```
✅ Direct Playwright wrapper with stealth enhancements

---

## 3. ACTUAL STRUCTURE

```
szkrabok-playwright-mcp/
├── package.json
├── index.js                  # entry point
├── server.js                 # MCP setup
├── config.js                 # centralized config (TIMEOUT, VIEWPORT, etc)
├── cli.js                    # CLI tools
├── upstream/
│   └── wrapper.js            # playwright wrapper (not using @microsoft/playwright-mcp)
├── tools/
│   ├── session.js            # session CRUD
│   ├── workflow.js           # login, fillForm, scrape
│   ├── navigate.js           # goto, back, forward
│   ├── interact.js           # click, type, select
│   ├── extract.js            # text, html, screenshot, evaluate
│   └── registry.js           # tool registration & dispatch
├── core/
│   ├── pool.js               # session contexts
│   ├── storage.js            # persist state
│   └── stealth.js            # inject stealth
├── utils/
│   ├── logger.js
│   └── errors.js
├── test/
│   ├── basic.test.js
│   └── scrap.test.js
├── scripts/
│   └── setup.js
└── sessions/
    └── {id}/
        ├── state.json        # Playwright storage
        └── meta.json         # our metadata
```

---

## 4. INTEGRATION STRATEGY

### Direct Playwright wrapper (no Microsoft MCP dependency)

```js
// upstream/wrapper.js
import { chromium } from 'playwright'
import { enhanceWithStealth } from '../core/stealth.js'
import { TIMEOUT, HEADLESS, findChromiumPath } from '../config.js'

export const getBrowser = async (options = {}) => {
  const pw = options.stealth ? enhanceWithStealth(chromium) : chromium
  const executablePath = findChromiumPath()
  
  return await pw.launch({
    headless: options.headless ?? HEADLESS,
    executablePath,
    ...options,
  })
}

export const navigate = async (page, url, options = {}) => {
  return page.goto(url, {
    waitUntil: options.waitUntil || 'domcontentloaded',
    timeout: options.timeout || TIMEOUT,
  })
}
```

### Our tools call wrapper

```js
// tools/navigate.js
export const goto = async args => {
  const { id, url, wait = 'domcontentloaded' } = args
  const session = pool.get(id)

  await upstream.navigate(session.page, url, { waitUntil: wait })
  await storage.updateMeta(id, { lastUrl: url })

  return { success: true, url }
}
```

---

## 5. TOOL MAPPING

### Direct Proxy (thin wrapper)
```
navigate → playwright_navigate
click → playwright_click
screenshot → playwright_screenshot
evaluate → playwright_evaluate
```

### Enhanced (add session context)
```
session.open → 
  1. create context
  2. load state.json
  3. inject stealth
  4. call playwright_navigate
  
extract.text →
  1. validate session
  2. call playwright_evaluate
  3. cache result in meta
```

### New (our abstractions)
```
session.list
session.delete
workflow.login(id, credentials)
workflow.fillForm(id, data)
```

---

## 6. STEALTH INJECTION

### Implementation
Using playwright-extra and puppeteer-extra-plugin-stealth:

```js
// core/stealth.js
import { addExtra } from 'playwright-extra'
import StealthPlugin from 'puppeteer-extra-plugin-stealth'

export const enhanceWithStealth = browser => {
  const enhanced = addExtra(browser)
  const stealth = StealthPlugin()

  // Disable conflicting evasions
  stealth.enabledEvasions.delete('user-data-dir')

  // Enable specific evasions
  stealth.enabledEvasions.add('navigator.webdriver')
  stealth.enabledEvasions.add('chrome.runtime')
  // ... other evasions

  enhanced.use(stealth)
  return enhanced
}
```

Apply during browser launch:
```js
// upstream/wrapper.js
const pw = options.stealth ? enhanceWithStealth(chromium) : chromium
const browser = await pw.launch({ headless: false, ... })
```

---

## 7. MVP TOOLS

### Session Management (OURS)
```ts
session.open(id: string, url?: string, config?: SessionConfig)
session.close(id: string, save?: boolean)
session.list(): SessionInfo[]
session.delete(id: string)
```

### Browser Control (PROXIED)
```ts
nav.goto(id, url, wait?)          → playwright_navigate
interact.click(id, selector)       → playwright_click
interact.type(id, selector, text)  → playwright_fill
extract.text(id, selector?)        → playwright_evaluate
extract.screenshot(id, opts?)      → playwright_screenshot
eval.run(id, code)                 → playwright_evaluate
```

### Workflows (NEW)
```ts
workflow.login(id, {username, password, loginUrl})
workflow.scrape(id, {urls, selectors, paginate?})
workflow.fillForm(id, fields)
```

---

## 8. SESSION LIFECYCLE

```
1. LLM: session.open('work', 'gmail.com')
   ↓
2. SZKRABOK creates context
   ↓
3. Load sessions/work/state.json
   ↓
4. Inject stealth
   ↓
5. Call upstream.navigate('gmail.com')
   ↓
6. Store context in pool

...user interacts...

7. LLM: session.close('work')
   ↓
8. Call context.storageState()
   ↓
9. Save to sessions/work/state.json
   ↓
10. Update meta.json
   ↓
11. Dispose context
```

---

## 9. EPICS & STORIES

### EPIC 1: Foundation (MVP)

**ST-1.1** Upstream integration
- import @microsoft/playwright-mcp
- create wrapper class
- proxy all tools

**ST-1.2** Session system
- context pool
- state persistence
- metadata tracking

**ST-1.3** Stealth injection
- playwright-extra setup
- context creation hook
- validation

**ST-1.4** Core tools
- session CRUD
- navigation proxy
- interaction proxy

**DoD:** can open session, navigate, persist state

---

### EPIC 2: Workflow Abstractions

**ST-2.1** Login helper
- detect login forms
- auto-fill credentials
- wait for redirect

**ST-2.2** Form automation
- schema-based filling
- validation
- error handling

**ST-2.3** Extraction pipelines
- multi-page scraping
- pagination handling
- data normalization

**DoD:** one-line login/scrape workflows

---

### EPIC 3: Observability

**ST-3.1** Session history
- action log per session
- replay capability

**ST-3.2** Debug exports
- HAR capture
- screenshot on error
- network trace

**ST-3.3** Metrics
- tool call latency
- error rates
- session stats

**DoD:** full debug bundle on failure

---

### EPIC 4: Advanced Sessions

**ST-4.1** Session templates
- named presets
- config inheritance

**ST-4.2** Session sharing
- export/import
- encryption

**ST-4.3** Concurrent sessions
- pool limits
- resource management

**DoD:** 10 concurrent sessions stable

---

## 10. IMPLEMENTATION PHASES

### Phase 1: Integration (Week 1)
```
- install @microsoft/playwright-mcp
- create wrapper
- proxy 5 core tools
- basic session open/close
```

### Phase 2: Persistence (Week 1)
```
- storageState save/load
- metadata system
- session listing
- stealth injection
```

### Phase 3: Workflows (Week 2)
```
- login helper
- form filling
- basic scraping
```

### Phase 4: Production (Week 1)
```
- error handling
- logging
- docs
- tests
```

**Total: 5 weeks to production**

---

## 11. DEPENDENCY GRAPH

```
SZKRABOK (MCP Server)
    ├── playwright (direct)
    ├── playwright-extra
    ├── puppeteer-extra-plugin-stealth
    └── @modelcontextprotocol/sdk
```

**Key:** Direct Playwright usage, no Microsoft MCP dependency. We build our own wrapper.

---

## 12. EXAMPLE USAGE

```javascript
// LLM calls:

// 1. Create session with stealth
session.open({
  id: 'demo',
  url: 'https://example.com',
  config: {
    stealth: true,
    viewport: {width: 1920, height: 1080}
  }
})

// 2. Use interaction tools
interact.click({ id: 'demo', selector: 'button.login' })
interact.type({ id: 'demo', selector: 'input[name=email]', text: 'user@example.com' })

// 3. Use workflows
workflow.login({
  id: 'demo',
  username: 'user',
  password: 'pass',
  submitSelector: 'button[type=submit]'
})

// 4. Extract data
extract.text({ id: 'demo', selector: '.result' })

// 5. Close and persist
session.close({ id: 'demo' })

// Next conversation:
session.open({ id: 'demo' }) // resumes from saved state
```

---

## 13. WHY THIS WORKS

✅ **Leverage upstream:** all browser ops battle-tested  
✅ **Add value:** sessions, stealth, workflows  
✅ **No duplication:** don't rewrite Playwright bindings  
✅ **Maintainable:** upstream updates = we benefit  
✅ **Clear boundaries:** we own persistence, they own browser  

---

## 14. ANTI-PATTERNS AVOIDED

❌ Trying to call their MCP from ours (impossible)  
❌ Forking their code (maintenance hell)  
❌ Reimplementing Playwright bindings (waste)  
✅ Import as library + wrap with abstractions  

---

## 15. SUCCESS CRITERIA

### MVP
- [ ] 10+ tools working
- [ ] sessions persist across restarts
- [ ] stealth active
- [ ] no crashes in 1h load test

### Production  
- [ ] < 200ms tool overhead
- [ ] 99.9% reliability
- [ ] workflow library (login, forms, scrape)
- [ ] docs + examples

---

## 16. REFERENCES

- **Playwright**
  https://playwright.dev

- **Playwright Extra**
  https://github.com/berstend/puppeteer-extra/tree/master/packages/playwright-extra

- **Puppeteer Extra Plugin Stealth**
  https://github.com/berstend/puppeteer-extra/tree/master/packages/puppeteer-extra-plugin-stealth

- **MCP Specification**
  https://modelcontextprotocol.io

---

## STATUS

**Architecture:** validated  
**Approach:** library wrapping (not MCP chaining)  
**Risk:** low (standard composition pattern)  
**Timeline:** 5 weeks to v1.0  

🚀 **READY TO BUILD**