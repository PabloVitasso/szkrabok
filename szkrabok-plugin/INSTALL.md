# Installation Guide

## Quick Install

### Option 1: Direct Path (Recommended)

Add to your Claude Code configuration file:

**Location:** `~/.config/claude/settings.json` or similar

```json
{
  "plugins": [
    "/home/jones2/mega/research/szkrabok/szkrabok-plugin"
  ]
}
```

### Option 2: Using Claude Code CLI

```bash
# If claude has a plugin install command
claude plugin install /home/jones2/mega/research/szkrabok/szkrabok-plugin
```

### Option 3: Symlink to Claude Plugins Directory

```bash
# If Claude Code has a plugins directory
ln -s /home/jones2/mega/research/szkrabok/szkrabok-plugin \
      ~/.config/claude/plugins/szkrabok-browser-automation
```

## Verify Installation

After installation, verify the plugin is loaded:

1. Start Claude Code
2. Ask: "What skills do you have?"
3. You should see "google-search" in the list

Or try using it directly:

```
Search Google for "test query" and take a screenshot
```

## Configuration

The plugin automatically configures the szkrabok MCP server. No additional configuration needed!

The MCP server configuration in `.mcp.json` uses a relative path to the parent directory where the szkrabok server lives.

## Troubleshooting

### Plugin not loading

Check Claude Code logs for errors:
```bash
# Location depends on Claude Code implementation
~/.config/claude/logs/
```

### MCP server not connecting

Test the server manually:
```bash
cd /home/jones2/mega/research/szkrabok
npm start
```

### Skill not found

Verify the skill file exists:
```bash
ls szkrabok-plugin/skills/google-search/SKILL.md
```

## Manual Testing

Test the skill without Claude Code:

```bash
cd /home/jones2/mega/research/szkrabok

# Start the server
npm start

# In another terminal, test a session
node cli.js session open test-google --url https://google.com
node cli.js session list
node cli.js session close test-google
```

## Next Steps

Once installed:

1. Try the google-search skill
2. Explore the examples in `skills/google-search/examples/`
3. Check the reference docs in `skills/google-search/references/`
4. Add more skills to the plugin!

## Support

- Plugin issues: Check this project's GitHub issues
- Skill documentation: See `skills/google-search/SKILL.md`
- MCP server docs: See main `README.md`
