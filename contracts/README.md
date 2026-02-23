# MCP Contracts

This directory contains shared contracts and schemas for the MCP (Model Context Protocol) servers in this repository.

## Purpose

The contracts directory provides:

- JSON Schema definitions for tool inputs/outputs
- Example request/response fixtures
- Protocol version tracking
- Shared validation rules

## Structure

```
contracts/
├── mcp/
│   ├── schemas/          # JSON Schema files
│   ├── examples/         # Request/response examples
│   └── version.txt       # Protocol version
└── README.md
```

## Schema Versioning

Contracts follow semantic versioning. Current version is stored in `mcp/version.txt`.

**Version format:** `MAJOR.MINOR.PATCH`

- **MAJOR:** Breaking changes to tool signatures
- **MINOR:** New tools or non-breaking additions
- **PATCH:** Bug fixes or documentation updates

## Usage

Servers can reference these schemas for:

- Input validation
- Output formatting
- Documentation generation
- Contract testing

## Adding New Schemas

1. Create schema in `mcp/schemas/`
2. Add example in `mcp/examples/`
3. Update version if needed
4. Run `scripts/check-contracts.sh` to validate

## Validation

Schemas are validated in CI using JSON Schema validators:

- Node.js servers: AJV
- Python servers: jsonschema

Run validation locally:

```bash
cd /path/to/repo
./scripts/check-contracts.sh
```

## Notes

- Schemas are server-agnostic and can be shared
- Sessions are NOT shared between servers
- Each server may implement contracts differently based on their runtime
