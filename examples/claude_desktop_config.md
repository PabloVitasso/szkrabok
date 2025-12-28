# Claude Desktop Configuration Examples

Configuration file location: `~/.config/Claude/claude_desktop_config.json`

## Recommended: Dual Configuration

Configure two MCP servers for different use cases:

```json
{
  "mcpServers": {
    "szkrabok": {
      "command": "node",
      "args": [
        "/home/jones2/mega/research/szkrabok/index.js",
        "--headless"
      ]
    },
    "szkrabok-visible": {
      "command": "node",
      "args": [
        "/home/jones2/mega/research/szkrabok/index.js",
        "--no-headless"
      ],
      "env": {
        "DISPLAY": ":0"
      }
    }
  }
}
```

**Usage:**
- **szkrabok**: Headless automation (default for all automated tasks)
- **szkrabok-visible**: Manual login, debugging, element inspection

**Note:** Browser launches lazily (only when `session.open` is called), so MCP server initialization doesn't show empty browser window. This matches playwright-mcp behavior.

## Basic Configuration (Auto-detect)

Auto-detects headless mode based on DISPLAY environment:
- With DISPLAY: Visible browser by default
- Without DISPLAY: Headless browser by default

```json
{
  "mcpServers": {
    "szkrabok": {
      "command": "node",
      "args": [
        "/home/jones2/mega/research/szkrabok/index.js"
      ]
    }
  }
}
```

## Force Headless Mode (Invisible Browser)

Always run in headless mode, regardless of DISPLAY:

```json
{
  "mcpServers": {
    "szkrabok": {
      "command": "node",
      "args": [
        "/home/jones2/mega/research/szkrabok/index.js",
        "--headless"
      ]
    }
  }
}
```

## Visible Browser with DISPLAY

For interactive browsing (manual login, debugging):

```json
{
  "mcpServers": {
    "szkrabok": {
      "command": "node",
      "args": [
        "/home/jones2/mega/research/szkrabok/index.js",
        "--no-headless"
      ],
      "env": {
        "DISPLAY": ":0"
      }
    }
  }
}
```

**Note:** Requires X server running on DISPLAY :0

## Visible Browser without X Server (xvfb)

For servers or containers without X display:

```json
{
  "mcpServers": {
    "szkrabok": {
      "command": "xvfb-run",
      "args": [
        "-a",
        "node",
        "/home/jones2/mega/research/szkrabok/index.js",
        "--no-headless"
      ]
    }
  }
}
```

**xvfb-run flags:**
- `-a` - Auto-select available display number
- Creates virtual framebuffer for headful browser without physical display

## Custom Timeout

```json
{
  "mcpServers": {
    "szkrabok": {
      "command": "node",
      "args": [
        "/home/jones2/mega/research/szkrabok/index.js"
      ],
      "env": {
        "TIMEOUT": "60000"
      }
    }
  }
}
```

## Session Persistence Workflow

### Phase 1: Manual Login (Visible Browser)

Use this config for one-time manual login:

```json
{
  "mcpServers": {
    "szkrabok": {
      "command": "node",
      "args": [
        "/home/jones2/mega/research/szkrabok/index.js",
        "--no-headless"
      ],
      "env": {
        "DISPLAY": ":0"
      }
    }
  }
}
```

**MCP Workflow:**
1. Call `session.open({ id: 'myapp', url: 'https://app.example.com/login', config: { stealth: true }})`
2. Browser opens visibly
3. Log in manually
4. Call `wait.forClose({ id: 'myapp' })` - waits for you to close browser
5. Call `session.close({ id: 'myapp', save: true })` - saves cookies/state
6. Session persisted to `~/.szkrabok/sessions/myapp/`

### Phase 2: Automated Access (Headless)

After manual login, switch config to headless:

```json
{
  "mcpServers": {
    "szkrabok": {
      "command": "node",
      "args": [
        "/home/jones2/mega/research/szkrabok/index.js",
        "--headless"
      ]
    }
  }
}
```

**MCP Workflow:**
1. Call `session.open({ id: 'myapp', url: 'https://app.example.com/dashboard', config: { stealth: true }})`
2. Session automatically restores cookies/state
3. Already logged in, no user interaction needed
4. Automate tasks in headless mode

## Path Placeholders

Replace absolute paths with your actual installation:

```json
{
  "mcpServers": {
    "szkrabok": {
      "command": "node",
      "args": [
        "/path/to/your/szkrabok/index.js"
      ]
    }
  }
}
```

**Common locations:**
- Development: `/home/username/projects/szkrabok/index.js`
- Global npm: `$(npm root -g)/szkrabok/index.js`
- npx: Use `"command": "npx"` with `"args": ["szkrabok", "--headless"]` (if published to npm)

## Troubleshooting

### "Error: Failed to launch browser"

**Cause:** No DISPLAY and trying to run headed mode

**Solutions:**
1. Use `--headless` flag (recommended)
2. Add xvfb-run wrapper
3. Set DISPLAY environment variable

### "Browser crashes immediately"

**Cause:** Missing system dependencies

**Solution:**
```bash
# Install Playwright browsers
npx playwright install chromium --with-deps
```

### "Session not persisting"

**Cause:** `save: false` or session directory permissions

**Check:**
```bash
ls -la ~/.szkrabok/sessions/
chmod -R u+w ~/.szkrabok/sessions/
```

## Advanced: Multiple Profiles

Run separate szkrabok instances with different profiles:

```json
{
  "mcpServers": {
    "szkrabok-personal": {
      "command": "node",
      "args": [
        "/home/jones2/mega/research/szkrabok/index.js",
        "--headless"
      ]
    },
    "szkrabok-work": {
      "command": "node",
      "args": [
        "/home/jones2/mega/research/szkrabok/index.js",
        "--no-headless"
      ],
      "env": {
        "DISPLAY": ":0"
      }
    }
  }
}
```

Each server maintains separate session storage and browser instances.
