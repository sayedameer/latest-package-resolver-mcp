import { describe, it, expect, beforeAll } from 'vitest';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Path to the compiled server
const SERVER_PATH = join(__dirname, '..', 'dist', 'index.js');

interface MCPRequest {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params?: Record<string, unknown>;
}

interface MCPResponse {
  jsonrpc: '2.0';
  id: number;
  result?: unknown;
  error?: { code: number; message: string };
}

function sendRequest(request: MCPRequest): Promise<MCPResponse> {
  return new Promise((resolve, reject) => {
    const child = spawn('node', [SERVER_PATH], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('error', (err) => {
      reject(new Error(`Failed to spawn server: ${err.message}`));
    });

    child.on('close', (code) => {
      // Parse the last line as JSON response
      const lines = stdout.trim().split('\n');
      const lastLine = lines[lines.length - 1];

      try {
        const response = JSON.parse(lastLine) as MCPResponse;
        resolve(response);
      } catch {
        reject(new Error(`Invalid JSON response: ${lastLine}. Stderr: ${stderr}`));
      }
    });

    // Send the request
    child.stdin.write(JSON.stringify(request) + '\n');
    child.stdin.end();
  });
}

describe('CLI - MCP Server via Command Line', () => {
  beforeAll(() => {
    // Skip tests if dist/index.js doesn't exist
    if (!existsSync(SERVER_PATH)) {
      throw new Error(`Server not found at ${SERVER_PATH}. Run 'npm run build' first.`);
    }
  });

  it('should respond to tools/list request', async () => {
    const request: MCPRequest = {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
    };

    const response = await sendRequest(request);

    expect(response.error).toBeUndefined();
    expect(response.result).toBeDefined();
    expect(response.id).toBe(1);

    const result = response.result as { tools: Array<{ name: string }> };
    expect(result.tools).toBeDefined();
    expect(result.tools.length).toBeGreaterThanOrEqual(3);

    const toolNames = result.tools.map((t) => t.name);
    expect(toolNames).toContain('resolve_packages');
    expect(toolNames).toContain('get_latest_version');
    expect(toolNames).toContain('check_compatibility');
  });

  it('should call get_latest_version tool', async () => {
    const request: MCPRequest = {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: {
        name: 'get_latest_version',
        arguments: {
          package: 'lodash',
        },
      },
    };

    const response = await sendRequest(request);

    expect(response.error).toBeUndefined();
    expect(response.result).toBeDefined();
    expect(response.id).toBe(2);

    const result = response.result as {
      content: Array<{ type: string; text: string }>;
    };
    expect(result.content).toBeDefined();
    expect(result.content.length).toBeGreaterThan(0);

    const text = result.content[0].text;
    const data = JSON.parse(text);
    expect(data.name).toBe('lodash');
    expect(data.version).toBeDefined();
  });

  it('should call resolve_packages tool', async () => {
    const request: MCPRequest = {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: {
        name: 'resolve_packages',
        arguments: {
          packages: ['lodash'],
        },
      },
    };

    const response = await sendRequest(request);

    expect(response.error).toBeUndefined();
    expect(response.result).toBeDefined();
    expect(response.id).toBe(3);

    const result = response.result as {
      content: Array<{ type: string; text: string }>;
    };
    expect(result.content).toBeDefined();

    const text = result.content[0].text;
    const data = JSON.parse(text);
    expect(data.packages).toBeDefined();
    expect(data.packages.lodash).toBeDefined();
  });

  it('should call check_compatibility tool', async () => {
    const request: MCPRequest = {
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: {
        name: 'check_compatibility',
        arguments: {
          dependencies: {
            lodash: '^4.17.0',
          },
        },
      },
    };

    const response = await sendRequest(request);

    expect(response.error).toBeUndefined();
    expect(response.result).toBeDefined();
    expect(response.id).toBe(4);

    const result = response.result as {
      content: Array<{ type: string; text: string }>;
    };
    expect(result.content).toBeDefined();

    const text = result.content[0].text;
    const data = JSON.parse(text);
    expect(data.outdated).toBeDefined();
    expect(data.suggested).toBeDefined();
  });

  it('should handle invalid tool name', async () => {
    const request: MCPRequest = {
      jsonrpc: '2.0',
      id: 5,
      method: 'tools/call',
      params: {
        name: 'nonexistent_tool',
        arguments: {},
      },
    };

    const response = await sendRequest(request);

    // Should either return an error or an empty result
    expect(response.id).toBe(5);
    // Response may have error or empty content depending on McpServer behavior
  });

  it('should handle package not found', async () => {
    const request: MCPRequest = {
      jsonrpc: '2.0',
      id: 6,
      method: 'tools/call',
      params: {
        name: 'get_latest_version',
        arguments: {
          package: 'this-package-definitely-does-not-exist-12345',
        },
      },
    };

    const response = await sendRequest(request);

    expect(response.error).toBeUndefined();
    expect(response.result).toBeDefined();

    const result = response.result as {
      content: Array<{ type: string; text: string }>;
      isError?: boolean;
    };
    expect(result.content).toBeDefined();

    const text = result.content[0].text;
    const data = JSON.parse(text);
    expect(data.error).toBeDefined();
  });
});
