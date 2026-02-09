# Szkrabok Browser Automation Plugin

Claude Code plugin providing browser automation skills using the szkrabok MCP server.

## Installation

### Option 1: Install from this directory

```bash
# Add to your Claude Code settings
claude plugin install /home/jones2/mega/research/szkrabok/szkrabok-plugin
```

### Option 2: Manual installation

Add to your `.claude/settings.local.json`:

```json
{
  "plugins": [
    "/home/jones2/mega/research/szkrabok/szkrabok-plugin"
  ]
}
```

## Included Skills

### Google Search

Automated Google search with screenshots and data extraction.

**Usage:**
```
Search Google for "unicorn" and take a screenshot
```

See `skills/google-search/SKILL.md` for full documentation.

## MCP Server Configuration

This plugin automatically configures the szkrabok MCP server. The server provides:

- **Session Management** - Open/close/list browser sessions
- **Navigation** - Go to URLs, back/forward navigation
- **Interaction** - Click, type, select dropdowns
- **Extraction** - Screenshots, text, HTML, evaluate JavaScript
- **Workflows** - Login automation, form filling, scraping

## Skills Included

- `google-search` - Google search automation

## Requirements

- Node.js 18+
- szkrabok MCP server (included)
- Chromium/Chrome browser

## Development

To add more skills to this plugin:

```bash
cd szkrabok-plugin/skills
mkdir my-new-skill
cd my-new-skill
cat > SKILL.md << 'EOF'
---
name: My New Skill
description: Description of when to use this skill
version: 1.0.0
---

# Skill instructions here...
EOF
```

Skills are automatically discovered by Claude Code.

## License

See parent project LICENSE.
