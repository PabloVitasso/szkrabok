# Next Steps After Reauth

## 1. Push to Remote
```bash
cd /home/jones2/mega/research/szkrabok

# Option A: SSH
git remote set-url origin git@github.com:PabloVitasso/szkrabok.git
git push --force origin main

# Option B: HTTPS with token
git push --force origin main
# Use personal access token as password
```

## 2. Update MCP Config
**Critical**: Path changed from `index.js` to `src/index.js`

File: `~/.config/Claude/claude_desktop_config.json`
```json
{
  "mcpServers": {
    "szkrabok": {
      "command": "node",
      "args": ["/home/jones2/mega/research/szkrabok/szkrabok.playwright.mcp.stealth/src/index.js"],
      "env": {"HEADLESS": "true"}
    }
  }
}
```

Or Claude CLI:
```bash
claude mcp add szkrabok -- node /home/jones2/mega/research/szkrabok/szkrabok.playwright.mcp.stealth/src/index.js --headless
```

## 3. Verify Everything Works
```bash
cd szkrabok.playwright.mcp.stealth
npm test                    # 8 tests should pass
npm start                   # Server should start
```

## 4. Test MCP Integration
- Restart Claude Desktop/CLI
- Try: "List all szkrabok sessions"
- Verify all 67 tools appear

## 5. Decide on Crawl4AI Server
Directory reserved: `szkrabok.crawl4ai.mcp.stealth/`
Options:
- Python crawl4ai library
- Node.js adaptation
- Skip for now

## 6. Update GitHub Workflows (Optional)
Files to update for monorepo CI:
- `.github/workflows/*.yml`
- Update paths to `szkrabok.playwright.mcp.stealth/`

## Status
- ✅ Migration complete locally
- ✅ Merged to main
- ✅ All tests passing (8/8)
- ⏳ Pending: Push to remote
- ⏳ Pending: Update MCP config

Branch: main
Commit: 6cad6f5
Tag: pre-monorepo-migration (rollback point)

## Cleanup (Optional)
```bash
# Delete migration branch after successful push
git branch -D migration/monorepo-structure
git push origin --delete migration/monorepo-structure  # if it exists on remote
```
