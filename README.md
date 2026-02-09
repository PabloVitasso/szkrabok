# Szkrabok - Stealth Browser Automation

A monorepo containing MCP (Model Context Protocol) servers for advanced browser automation and web scraping with stealth capabilities.

## Servers

### 🎭 szkrabok.playwright.mcp.stealth (Node.js)

Production-grade Playwright-based browser automation with 67 tools for session management, interaction, extraction, and testing.

**Features:**
- Persistent browser sessions with state management (cookies, localStorage, etc.)
- Stealth mode to evade bot detection
- 67 tools combining szkrabok and playwright-mcp capabilities
- Accessibility tree-based and CSS selector-based interactions
- Session pooling and lifecycle management

**[View Documentation →](./szkrabok.playwright.mcp.stealth/README.md)**

### 🕷️ szkrabok.crawl4ai.mcp.stealth (Python)

*Coming Soon* - Crawl4AI-powered intelligent scraping server with LLM-based extraction.

**[View Documentation →](./szkrabok.crawl4ai.mcp.stealth/README.md)**

## Quick Start

### Prerequisites
- Node.js ≥18.0.0 (for Playwright server)
- Python ≥3.10 (for Crawl4AI server)
- Git

### Install Playwright Server

```bash
cd szkrabok.playwright.mcp.stealth
npm install
npm start
```

### Install Crawl4AI Server

```bash
cd szkrabok.crawl4ai.mcp.stealth
pip install -e .
python -m mcp_py.server
```

## MCP Configuration

Add to your Claude Desktop config:

```json
{
  "mcpServers": {
    "szkrabok": {
      "command": "node",
      "args": ["/path/to/szkrabok/szkrabok.playwright.mcp.stealth/src/index.js"],
      "env": {
        "HEADLESS": "true"
      }
    }
  }
}
```

## Repository Structure

```
szkrabok/
├── szkrabok.playwright.mcp.stealth/  # Node.js Playwright server
│   ├── src/                          # Source code
│   ├── tests/                        # Tests
│   ├── sessions/                     # Persistent sessions
│   └── package.json
│
├── szkrabok.crawl4ai.mcp.stealth/    # Python Crawl4AI server
│   ├── mcp_py/                       # Source code
│   ├── tests/                        # Tests
│   ├── sessions/                     # Persistent sessions
│   └── pyproject.toml
│
├── contracts/                         # Shared MCP contracts
│   └── mcp/                          # Protocol schemas
│
├── skills/                            # Shared Claude skills
│   └── google-search/
│
├── szkrabok-plugin/                   # Claude plugin definitions
│
└── scripts/                           # Repository-level scripts
```

## Development

### Lint All Servers
```bash
./scripts/lint-all.sh
```

### Test All Servers
```bash
./scripts/test-all.sh
```

### Validate Contracts
```bash
./scripts/check-contracts.sh
```

## Sessions

Each server maintains its own sessions directory:
- Playwright sessions: `szkrabok.playwright.mcp.stealth/sessions/`
- Crawl4AI sessions: `szkrabok.crawl4ai.mcp.stealth/sessions/`

Sessions are server-specific and cannot be shared between servers.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for contribution guidelines.

## License

MIT - See [LICENSE](./LICENSE)

## Security

See [SECURITY.md](./SECURITY.md) for security policies and reporting vulnerabilities.
