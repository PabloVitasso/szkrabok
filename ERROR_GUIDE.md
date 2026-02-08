# Szkrabok Error Resolution Guide

## 🔍 Using Context7 for Error Resolution

When you encounter errors with szkrabok, use **context7** to get the most up-to-date documentation and solutions.

### How to Use Context7

**General format:**
```
"Use context7 to check [library-name] documentation for [error-or-topic]"
```

**Examples:**

1. **Playwright errors:**
```
"Use context7 to check playwright documentation for browser launch errors"
"Use context7 to check playwright for headless mode configuration"
```

2. **Stealth plugin errors:**
```
"Use context7 to check puppeteer-extra-plugin-stealth for detection issues"
"Use context7 to check playwright-extra for plugin configuration"
```

3. **MCP SDK errors:**
```
"Use context7 to check @modelcontextprotocol/sdk for connection errors"
"Use context7 to check MCP SDK for tool registration issues"
```

4. **Testing errors:**
```
"Use context7 to check @playwright/test for fixture errors"
"Use context7 to check playwright test framework for timeout issues"
```

## 📚 Key Libraries in Szkrabok

| Library | Purpose | Check Context7 For |
|---------|---------|-------------------|
| `playwright` | Browser automation | Launch errors, navigation, selectors |
| `playwright-extra` | Plugin system | Stealth setup, plugin loading |
| `puppeteer-extra-plugin-stealth` | Fingerprint evasion | Detection issues, evasion failures |
| `@modelcontextprotocol/sdk` | MCP protocol | Connection, tool registration |
| `@playwright/test` | Testing framework | Fixtures, assertions, timeouts |
| `zod` | Schema validation | Schema errors, validation |

## 🐛 Common Error Patterns

### 1. Browser Launch Failures

**Error:**
```
browserType.launch: Executable doesn't exist
```

**Context7 query:**
```
"Use context7 to check playwright for browser installation"
```

**Quick fix:**
```bash
npx playwright install chromium
```

### 2. Stealth Detection

**Error:**
```
Bot detection on website X
```

**Context7 query:**
```
"Use context7 to check puppeteer-extra-plugin-stealth for latest evasion techniques"
```

**Quick check:**
```bash
npm test test/scrap.test.js
```

### 3. Session Persistence Issues

**Error:**
```
Session state not loading
```

**Context7 query:**
```
"Use context7 to check playwright for storageState usage"
```

**Quick check:**
```bash
ls -la sessions/
cat sessions/[id]/meta.json
```

### 4. MCP Connection Errors

**Error:**
```
Connection refused / Tool not found
```

**Context7 query:**
```
"Use context7 to check @modelcontextprotocol/sdk for stdio transport"
```

**Quick fix:**
```bash
# Test server manually
npm start
# Check if tools are registered
npx @modelcontextprotocol/inspector szkrabok
```

### 5. Test Failures

**Error:**
```
Test timeout / Fixture errors
```

**Context7 query:**
```
"Use context7 to check @playwright/test for fixture best practices"
```

**Quick fix:**
```bash
# Run specific test with verbose output
npx playwright test tests/szkrabok/session.spec.ts --debug
```

## 🔧 Debug Commands

### Check Dependencies
```bash
npm list playwright playwright-extra puppeteer-extra-plugin-stealth
```

### Verify Installation
```bash
npm test
```

### Test MCP Connection
```bash
npx @modelcontextprotocol/inspector szkrabok
```

### Check Browser Installation
```bash
npx playwright install --help
ls ~/.cache/ms-playwright/
```

### View Logs
```bash
tail -f logs/szkrabok.log
```

## 💡 Best Practices

1. **Always check context7 first** for library-specific errors
2. **Run tests** to verify functionality: `npm test`
3. **Test manually** if MCP has issues: `npm start`
4. **Check logs** for detailed error messages
5. **Use MCP Inspector** to debug tool registration

## 📞 When to Use Each Resource

| Issue Type | Resource | Example |
|------------|----------|---------|
| Library API changes | **Context7** | "Check playwright 1.59 breaking changes" |
| Installation issues | **INSTALL_COMPLETE.md** | How to configure Claude Desktop |
| Usage examples | **README.md** | How to use workflow.login |
| Feature overview | **FINAL_SUMMARY.md** | What tools are available |
| Test issues | **TESTS_MIGRATED.md** | How tests are structured |
| Migration history | **SYNC_STRATEGY.md** | How szkrabok was built |

## 🎯 Quick Reference

**Most common context7 queries:**

```bash
# When tests fail
"Use context7 to check playwright test for [specific-error]"

# When stealth breaks
"Use context7 to check puppeteer-extra-plugin-stealth for detection bypass"

# When MCP tools don't work
"Use context7 to check @modelcontextprotocol/sdk for tool schema"

# When browser won't launch
"Use context7 to check playwright for headless mode on linux"

# When sessions don't persist
"Use context7 to check playwright for storageState and cookies"
```

---

**Remember**: Context7 provides the **latest** documentation, which is especially important for:
- Breaking changes in new versions
- New features or APIs
- Deprecated methods
- Security updates
- Bug fixes and workarounds

Always consult context7 for library-specific errors before diving into debugging!
