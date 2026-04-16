import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { registry } from './registry.js';
import { resolver } from './resolver.js';
import type { PackageMetadata } from './types.js';

// Mock the registry
vi.mock('./registry.js', () => ({
  registry: {
    getPackageMetadata: vi.fn(),
    getPackageVersions: vi.fn(),
    getSpecificVersion: vi.fn(),
    clearCache: vi.fn(),
  },
}));

describe.skip('MCP Server Integration', { timeout: 15000 }, () => {
  let client: Client;
  let server: Server;

  beforeAll(async () => {
    // Create server
    server = new Server(
      { name: 'test-server', version: '1.0.0' },
      { capabilities: { tools: {} } }
    );

    // Set up tool handlers
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

    server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'resolve_packages',
          description: 'Resolve packages',
          inputSchema: {
            type: 'object',
            properties: {
              packages: { type: 'array' },
              node: { type: 'string' },
              npm: { type: 'string' },
            },
            required: ['packages'],
          },
        },
        {
          name: 'get_latest_version',
          description: 'Get latest version',
          inputSchema: {
            type: 'object',
            properties: {
              package: { type: 'string' },
            },
            required: ['package'],
          },
        },
        {
          name: 'check_compatibility',
          description: 'Check compatibility',
          inputSchema: {
            type: 'object',
            properties: {
              dependencies: { type: 'object' },
              devDependencies: { type: 'object' },
              peerDependencies: { type: 'object' },
              node: { type: 'string' },
              npm: { type: 'string' },
            },
          },
        },
      ],
    }));

    server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        if (name === 'resolve_packages') {
          const input = ResolvePackagesSchema.parse(args);
          const result = await resolver.resolvePackages(input.packages, {
            node: input.node,
            npm: input.npm,
          });
          return {
            content: [{ type: 'text', text: JSON.stringify(result) }],
          };
        }

        if (name === 'get_latest_version') {
          const input = GetLatestVersionSchema.parse(args);
          const metadata = await registry.getPackageMetadata(input.package);
          if (!metadata) {
            return {
              content: [{ type: 'text', text: JSON.stringify({ error: 'Package not found' }) }],
              isError: true,
            };
          }
          return {
            content: [{ type: 'text', text: JSON.stringify(metadata) }],
          };
        }

        if (name === 'check_compatibility') {
          const input = CheckCompatibilitySchema.parse(args);
          const result = await resolver.checkCompatibility(
            {
              dependencies: input.dependencies,
              devDependencies: input.devDependencies,
              peerDependencies: input.peerDependencies,
            },
            { node: input.node, npm: input.npm }
          );
          return {
            content: [{ type: 'text', text: JSON.stringify(result) }],
          };
        }

        throw new Error(`Unknown tool: ${name}`);
      } catch (error) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ error: String(error) }) }],
          isError: true,
        };
      }
    });

    // Create in-memory transport
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    // Connect client and server
    client = new Client({ name: 'test-client', version: '1.0.0' });
    await client.connect(clientTransport);
    await server.connect(serverTransport);
  });

  afterAll(async () => {
    await client.close();
    await server.close();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Tool listing', () => {
    it('lists all available tools', async () => {
      const tools = await client.listTools();

      expect(tools.tools).toHaveLength(3);
      expect(tools.tools.map(t => t.name)).toContain('resolve_packages');
      expect(tools.tools.map(t => t.name)).toContain('get_latest_version');
      expect(tools.tools.map(t => t.name)).toContain('check_compatibility');
    });

    it('tools have correct schemas', async () => {
      const tools = await client.listTools();

      const resolveTool = tools.tools.find(t => t.name === 'resolve_packages');
      expect(resolveTool?.inputSchema).toHaveProperty('properties.packages');
      expect(resolveTool?.inputSchema).toHaveProperty('properties.node');
    });
  });

  describe('resolve_packages tool', () => {
    it('resolves packages via MCP', async () => {
      const mockMetadata: PackageMetadata = {
        name: 'lodash',
        version: '4.17.21',
      };
      vi.mocked(registry.getPackageMetadata).mockResolvedValue(mockMetadata);

      const result = await client.callTool({
        name: 'resolve_packages',
        arguments: {
          packages: ['lodash'],
        },
      });

      expect(result.content).toHaveLength(1);
      const content = JSON.parse((result.content as Array<{ text: string }>)[0].text);
      expect(content.packages.lodash).toBe('^4.17.21');
    });

    it('handles invalid input gracefully', async () => {
      const result = await client.callTool({
        name: 'resolve_packages',
        arguments: {
          packages: 'not-an-array', // Invalid type
        },
      });

      expect(result.isError).toBe(true);
      expect((result.content as Array<{ text: string }>)[0].text).toContain('Invalid');
    });

    it('resolves with Node version constraint', async () => {
      const nextMeta: PackageMetadata = {
        name: 'next',
        version: '15.0.0',
        engines: { node: '>=18.17.0' },
      };
      vi.mocked(registry.getPackageMetadata).mockResolvedValue(nextMeta);

      const result = await client.callTool({
        name: 'resolve_packages',
        arguments: {
          packages: ['next'],
          node: '>=20',
        },
      });

      const content = JSON.parse((result.content as Array<{ text: string }>)[0].text);
      expect(content.packages.next).toBe('^15.0.0');
      expect(content.conflicts).toEqual([]);
    });
  });

  describe('get_latest_version tool', () => {
    it('fetches latest version via MCP', async () => {
      const mockMetadata: PackageMetadata = {
        name: 'react',
        version: '18.2.0',
        engines: { node: '>=12' },
        peerDependencies: { 'react-dom': '^18.0.0' },
      };
      vi.mocked(registry.getPackageMetadata).mockResolvedValue(mockMetadata);

      const result = await client.callTool({
        name: 'get_latest_version',
        arguments: {
          package: 'react',
        },
      });

      const content = JSON.parse((result.content as Array<{ text: string }>)[0].text);
      expect(content.version).toBe('18.2.0');
      expect(content.engines.node).toBe('>=12');
    });

    it('returns error for non-existent package', async () => {
      vi.mocked(registry.getPackageMetadata).mockResolvedValue(null);

      const result = await client.callTool({
        name: 'get_latest_version',
        arguments: {
          package: 'non-existent',
        },
      });

      expect(result.isError).toBe(true);
    });

    it('requires package parameter', async () => {
      const result = await client.callTool({
        name: 'get_latest_version',
        arguments: {},
      });

      expect(result.isError).toBe(true);
    });
  });

  describe('check_compatibility tool', () => {
    it('checks compatibility via MCP', async () => {
      const reactMeta: PackageMetadata = {
        name: 'react',
        version: '18.2.0',
      };
      vi.mocked(registry.getPackageMetadata).mockResolvedValue(reactMeta);

      const result = await client.callTool({
        name: 'check_compatibility',
        arguments: {
          dependencies: { react: '^17.0.0' },
        },
      });

      const content = JSON.parse((result.content as Array<{ text: string }>)[0].text);
      expect(content.outdated).toHaveLength(1);
      expect(content.outdated[0].package).toBe('react');
    });

    it('handles empty dependencies', async () => {
      const result = await client.callTool({
        name: 'check_compatibility',
        arguments: {},
      });

      const content = JSON.parse((result.content as Array<{ text: string }>)[0].text);
      expect(content.outdated).toEqual([]);
      expect(content.incompatible).toEqual([]);
    });

    it('checks all dependency types', async () => {
      const typesMeta: PackageMetadata = {
        name: '@types/node',
        version: '20.10.0',
      };
      vi.mocked(registry.getPackageMetadata).mockResolvedValue(typesMeta);

      const result = await client.callTool({
        name: 'check_compatibility',
        arguments: {
          dependencies: { 'some-pkg': '^1.0.0' },
          devDependencies: { '@types/node': '^18.0.0' },
          peerDependencies: { 'peer-pkg': '^0.5.0' },
        },
      });

      expect(result.content).toHaveLength(1);
    });
  });

  describe('Error handling', () => {
    it('handles unknown tool', async () => {
      const result = await client.callTool({
        name: 'unknown_tool',
        arguments: {},
      });

      expect(result.isError).toBe(true);
    });

    it('handles registry errors', async () => {
      vi.mocked(registry.getPackageMetadata).mockRejectedValue(new Error('Network error'));

      const result = await client.callTool({
        name: 'get_latest_version',
        arguments: { package: 'react' },
      });

      expect(result.isError).toBe(true);
    });
  });
});
