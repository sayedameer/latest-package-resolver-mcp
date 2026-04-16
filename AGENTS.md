# AGENTS.md

Guidance for AI agents working on the `@sayedameer/latest-package-resolver-mcp` package.

---

## Project Overview

An MCP (Model Context Protocol) server that resolves the latest compatible npm package versions. Useful when scaffolding JavaScript/TypeScript projects or updating dependencies. Always queries the npm registry live — never relies on stale training data.

Repository: `https://github.com/sayedameer/latest-package-resolver-mcp`

---

## Repository Structure

```
src/
  index.ts           # MCP server entry point, tool registration
  registry.ts        # npm registry client (fetch metadata, versions)
  resolver.ts        # Resolution logic (peer deps, engine constraints)
skills/
  npm-latest-package-resolver/
  pnpm-latest-package-resolver/
  yarn-latest-package-resolver/
  bun-latest-package-resolver/
```

---

## Build & Test

```bash
# Build TypeScript to dist/
npm run build

# Run tests
npm test

# Watch mode for development
npm run dev
```

---

## Coding Conventions

- **TypeScript** — ESM modules (`"type": "module"`)
- **Zod** — Use Zod schemas for all tool input validation
- **Node.js >= 20** — Required for running the server
- **MCP SDK** — Use `McpServer` from `@modelcontextprotocol/sdk/server/mcp.js` for registering tools

---

## MCP Tools

Three tools are exposed via the MCP server:

| Tool | Purpose |
|------|---------|
| `resolve_packages` | Resolve packages to latest mutually-compatible versions |
| `get_latest_version` | Get latest version + metadata for a single package |
| `check_compatibility` | Check existing dependencies for outdated/incompatible packages |

All tools return JSON text content wrapped in MCP `CallToolResult` format.

---

## Resolver Logic

The resolver (`src/resolver.ts`) handles:

1. **Peer dependency resolution** — When a package declares peer deps, the resolver ensures compatible versions are included in the result
2. **Engine constraint checking** — Validates against `engines.node` and `engines.npm` fields
3. **Semver range matching** — Uses npm's semver semantics for compatibility

The registry client (`src/registry.ts`):
- Fetches from `https://registry.npmjs.org/<pkg>/latest`
- Fetches full version list from `https://registry.npmjs.org/<pkg>` when needed for conflict resolution
- Uses `Accept: application/vnd.npm.install-v1+json` for smaller responses

---

## Agent Skills

The `skills/` folder contains skill definitions for the [skills.sh](https://skills.sh) ecosystem:
- `npm-latest-package-resolver`
- `pnpm-latest-package-resolver`
- `yarn-latest-package-resolver`
- `bun-latest-package-resolver`

Each skill is installable via:
```bash
npx skills add sayedameer/latest-package-resolver-mcp --skill=<name>
```

---

## Publishing

```bash
npm run build
npm test
npm publish --access public
```

The `package.json` `"files"` array controls what gets published:
- `dist/` (compiled JS)
- `skills/` (skill definitions)
- `AGENTS.md`, `README.md`
