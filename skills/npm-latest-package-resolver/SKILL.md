---
name: npm-latest-package-resolver
description: Resolve the latest compatible package versions when scaffolding or updating JS/TS projects. Queries the npm registry live via MCP — no stale training data.
metadata:
  author: sayedameer
  version: "1.0.0"
  source: https://github.com/sayedameer/latest-package-resolver-mcp
---

# npm-latest-package-resolver

An MCP server that resolves the latest compatible npm package versions when scaffolding JavaScript/TypeScript projects or updating dependencies. Always queries the npm registry live — no stale data.

---

## Command Line Usage

Run the MCP server directly via `npx`:

```bash
npx -y @sayedameer/latest-package-resolver-mcp
```

The server communicates via stdio using JSON-RPC. Send requests as JSON lines.

> ⚠️ **Timeout Warning**: API calls to the npm registry may take **5-10 seconds** depending on network conditions and the number of packages. Do not interrupt — wait for the JSON response.


### Example: resolve_packages

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"resolve_packages","arguments":{"packages":["next","react"],"node":">=20"}}}' | npx -y @sayedameer/latest-package-resolver-mcp
```

### Example: get_latest_version

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_latest_version","arguments":{"package":"next"}}}' | npx -y @sayedameer/latest-package-resolver-mcp
```

### Example: check_compatibility

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"check_compatibility","arguments":{"dependencies":{"next":"^14.0.0"},"node":"20.0.0"}}}' | npx -y @sayedameer/latest-package-resolver-mcp
```

---

## Available Tools

### `resolve_packages`

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

---

### `get_latest_version`

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

---

### `check_compatibility`

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

## Core Algorithm: Resolve Compatible Packages

### Step 1: Fetch Latest Metadata

For each package, fetch its latest metadata:

```
GET https://registry.npmjs.org/<package>/latest
```

Response includes:
- `version` — latest stable version
- `peerDependencies` — packages this one expects
- `engines` — required Node.js/npm versions
- `dependencies` — regular dependencies

### Step 2: Build Resolution Map

Maintain a map: `packageName -> resolvedVersion`

For each package:
1. Get latest version
2. Add to map: `{ [name]: "^" + version }`
3. Note its `peerDependencies`

### Step 3: Resolve Peer Conflicts

For each package:
- Check its `peerDependencies`
- Verify resolved versions satisfy peer ranges
- **If conflict**: Find compatible version by checking version history

### Step 4: Check Engine Constraints

For each package with target Node.js version:
- Check `engines.node` field
- Example: `"engines.node": ">=20"` means package needs Node 20+

---

## Semver Quick Reference

| Range | Meaning | Example Match |
|-------|---------|---------------|
| `^1.2.3` | Compatible with major | `1.3.0`, `1.9.9` (not `2.0.0`) |
| `~1.2.3` | Compatible with minor | `1.2.9` (not `1.3.0`) |
| `>=1.2.3` | Greater or equal | `1.2.3`, `2.0.0` |
| `*` | Any version | All versions |

---

## npm Registry Rate Limits

- Unauthenticated: ~100-500 requests per minute
- Use `Accept: application/vnd.npm.install-v1+json` for smaller responses
