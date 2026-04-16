# @sayedameer/latest-package-resolver-mcp

MCP server for AI agents to resolve the latest compatible npm packages when scaffolding or fixing JavaScript/TypeScript projects. Queries the npm registry live — no stale data.

[![npm version](https://badge.fury.io/js/@sayedameer%2Flatest-package-resolver-mcp.svg)](https://www.npmjs.com/package/@sayedameer/latest-package-resolver-mcp)

## Features

- **Live registry queries**: Always gets the latest package versions from npm
- **Peer dependency resolution**: Automatically resolves compatible peer dependency versions
- **Engine constraint checking**: Validates Node.js/npm version compatibility
- **Three MCP tools**: `resolve_packages`, `get_latest_version`, `check_compatibility`

## Requirements

- **Node.js**: >= 20.0.0

---

## Install as MCP Server

### Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "latest-package-resolver": {
      "command": "npx",
      "args": ["-y", "@sayedameer/latest-package-resolver-mcp"]
    }
  }
}
```

### Cursor

Add to `.cursor/mcp.json` (project-level) or `~/.cursor/mcp.json` (global):

```json
{
  "mcpServers": {
    "latest-package-resolver": {
      "command": "npx",
      "args": ["-y", "@sayedameer/latest-package-resolver-mcp"]
    }
  }
}
```

### VS Code / GitHub Copilot

Add to `.vscode/mcp.json`:

```json
{
  "servers": {
    "latest-package-resolver": {
      "command": "npx",
      "args": ["-y", "@sayedameer/latest-package-resolver-mcp"]
    }
  }
}
```

### Windsurf

Add to `mcp_config.json`:

```json
{
  "servers": {
    "latest-package-resolver": {
      "command": "npx",
      "args": ["-y", "@sayedameer/latest-package-resolver-mcp"]
    }
  }
}
```

---

## Install as Agent Skill

Install via [skills.sh](https://skills.sh):

```bash
npx skills add sayedameer/latest-package-resolver-mcp --skill='*'
```

Or install a specific skill:

```bash
npx skills add sayedameer/latest-package-resolver-mcp --skill=npm-latest-package-resolver
```

Available skills:
- `npm-latest-package-resolver`
- `pnpm-latest-package-resolver`
- `yarn-latest-package-resolver`
- `bun-latest-package-resolver`

---

## Available Tools

### 1. `resolve_packages`

Resolve a set of packages to their latest mutually-compatible versions.

**Input:**
```json
{
  "packages": ["next", "react", "tailwindcss"],
  "node": ">=20"
}
```

**Output:**
```json
{
  "packages": {
    "next": "^15.3.1",
    "react": "^19.1.0",
    "react-dom": "^19.1.0",
    "tailwindcss": "^4.0.0"
  },
  "conflicts": [],
  "engines": {
    "node": ">=20"
  }
}
```

### 2. `get_latest_version`

Get the latest version and metadata for a single package.

**Input:**
```json
{ "package": "next" }
```

**Output:**
```json
{
  "name": "next",
  "version": "15.3.1",
  "engines": { "node": ">=18.17.0" },
  "peerDependencies": {
    "react": "^18.2.0 || ^19.0.0",
    "react-dom": "^18.2.0 || ^19.0.0"
  }
}
```

### 3. `check_compatibility`

Check an existing set of dependencies for outdated or incompatible packages.

**Input:**
```json
{
  "dependencies": {
    "next": "^14.0.0",
    "react": "^18.2.0"
  },
  "node": "20.0.0"
}
```

**Output:**
```json
{
  "outdated": [
    {
      "package": "next",
      "current": "^14.0.0",
      "latest": "15.3.1",
      "issue": "outdated"
    }
  ],
  "incompatible": [],
  "engineIssues": [],
  "suggested": {
    "next": "^15.3.1",
    "react": "^18.2.0"
  }
}
```

---

## Supported Package Managers

Works with all package managers that use the npm registry:
- npm
- pnpm
- yarn
- bun

---

## License

ISC
