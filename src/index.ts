#!/usr/bin/env node
// MCP Server for latest-package-resolver-mcp

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { registry } from './registry.js';
import { resolver } from './resolver.js';

// Zod schemas for tool inputs
const ResolvePackagesSchema = z.object({
  packages: z.array(z.union([z.string(), z.object({ name: z.string(), version: z.string().optional() })])),
  node: z.string().optional(),
  npm: z.string().optional(),
});

const GetLatestVersionSchema = z.object({
  package: z.string(),
});

const CheckCompatibilitySchema = z.object({
  dependencies: z.record(z.string()).optional(),
  devDependencies: z.record(z.string()).optional(),
  peerDependencies: z.record(z.string()).optional(),
  node: z.string().optional(),
  npm: z.string().optional(),
});

// Create server
const server = new McpServer(
  {
    name: 'latest-package-resolver-mcp',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Register tools
server.registerTool(
  'resolve_packages',
  {
    description: 'Resolve a set of packages to their latest mutually-compatible versions. Checks peer dependencies and engine constraints.',
    inputSchema: ResolvePackagesSchema,
  },
  async (input) => {
    const result = await resolver.resolvePackages(input.packages, {
      node: input.node,
      npm: input.npm,
    });
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  }
);

server.registerTool(
  'get_latest_version',
  {
    description: 'Get the latest version and metadata for a single package from the npm registry.',
    inputSchema: GetLatestVersionSchema,
  },
  async (input) => {
    console.error(`[get_latest_version] Fetching ${input.package}...`);
    const metadata = await registry.getPackageMetadata(input.package);
    if (!metadata) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ error: `Package "${input.package}" not found` }, null, 2),
          },
        ],
        isError: true,
      };
    }
    console.error(`[get_latest_version] ✓ ${input.package}@${metadata.version}`);
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(metadata, null, 2),
        },
      ],
    };
  }
);

server.registerTool(
  'check_compatibility',
  {
    description: 'Check an existing set of dependencies for outdated or incompatible packages. Returns suggested upgrades.',
    inputSchema: CheckCompatibilitySchema,
  },
  async (input) => {
    const result = await resolver.checkCompatibility(
      {
        dependencies: input.dependencies,
        devDependencies: input.devDependencies,
        peerDependencies: input.peerDependencies,
      },
      {
        node: input.node,
        npm: input.npm,
      }
    );
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  }
);

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('latest-package-resolver-mcp server running on stdio');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
