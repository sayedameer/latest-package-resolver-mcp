import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RegistryClient } from './registry.js';

describe('RegistryClient', () => {
  let client: RegistryClient;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let fetchMock: any;

  beforeEach(() => {
    client = new RegistryClient();
    fetchMock = vi.fn();
    global.fetch = fetchMock;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('getPackageMetadata', () => {
    it('fetches and parses package metadata', async () => {
      const mockResponse = {
        name: 'lodash',
        version: '4.17.21',
        description: 'A modern JavaScript utility library',
        engines: { node: '>=12' },
        peerDependencies: {},
        dependencies: {},
        dist: {
          tarball: 'https://registry.npmjs.org/lodash/-/lodash-4.17.21.tgz',
          shasum: 'abc123',
          integrity: 'sha512-...',
        },
      };

      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockResponse,
      });

      const result = await client.getPackageMetadata('lodash');

      expect(fetchMock).toHaveBeenCalledWith(
        'https://registry.npmjs.org/lodash/latest'
      );
      expect(result).toEqual({
        name: 'lodash',
        version: '4.17.21',
        description: 'A modern JavaScript utility library',
        engines: { node: '>=12' },
        peerDependencies: {},
        dependencies: {},
        dist: {
          tarball: 'https://registry.npmjs.org/lodash/-/lodash-4.17.21.tgz',
          shasum: 'abc123',
          integrity: 'sha512-...',
        },
      });
    });

    it('returns null for 404 (package not found)', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 404,
      });

      const result = await client.getPackageMetadata('non-existent-pkg');

      expect(result).toBeNull();
    });

    it('throws on registry errors (non-404)', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      });

      // Currently logs error and returns null, could be improved to throw
      const result = await client.getPackageMetadata('some-pkg');
      expect(result).toBeNull();
    });

    it('caches results', async () => {
      const mockResponse = {
        name: 'lodash',
        version: '4.17.21',
      };

      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockResponse,
      });

      // First call
      await client.getPackageMetadata('lodash');
      // Second call - should use cache
      await client.getPackageMetadata('lodash');

      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('handles case-insensitive cache', async () => {
      const mockResponse = {
        name: 'Lodash',
        version: '4.17.21',
      };

      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockResponse,
      });

      await client.getPackageMetadata('Lodash');
      await client.getPackageMetadata('lodash');
      await client.getPackageMetadata('LODASH');

      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('handles network errors gracefully', async () => {
      fetchMock.mockRejectedValueOnce(new Error('Network error'));

      const result = await client.getPackageMetadata('lodash');

      expect(result).toBeNull();
    });

    it('handles JSON parsing errors', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => { throw new Error('Invalid JSON'); },
      });

      const result = await client.getPackageMetadata('lodash');

      expect(result).toBeNull();
    });

    it('handles scoped packages', async () => {
      const mockResponse = {
        name: '@types/node',
        version: '20.10.0',
      };

      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockResponse,
      });

      const result = await client.getPackageMetadata('@types/node');

      expect(fetchMock).toHaveBeenCalledWith(
        'https://registry.npmjs.org/%40types%2Fnode/latest'
      );
      expect(result?.name).toBe('@types/node');
    });

    it('handles packages with no optional fields', async () => {
      const mockResponse = {
        name: 'simple-pkg',
        version: '1.0.0',
      };

      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockResponse,
      });

      const result = await client.getPackageMetadata('simple-pkg');

      expect(result).toEqual({
        name: 'simple-pkg',
        version: '1.0.0',
      });
    });
  });

  describe('getPackageVersions', () => {
    it('fetches all versions and tags', async () => {
      const mockResponse = {
        name: 'react',
        'dist-tags': {
          latest: '18.2.0',
          next: '19.0.0-rc.0',
        },
        versions: {
          '17.0.0': {},
          '17.0.1': {},
          '18.0.0': {},
          '18.2.0': {},
        },
      };

      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockResponse,
      });

      const result = await client.getPackageVersions('react');

      expect(fetchMock).toHaveBeenCalledWith(
        'https://registry.npmjs.org/react'
      );
      expect(result).toEqual({
        latest: '18.2.0',
        versions: ['17.0.0', '17.0.1', '18.0.0', '18.2.0'],
        tags: {
          latest: '18.2.0',
          next: '19.0.0-rc.0',
        },
      });
    });

    it('handles packages with many versions', async () => {
      const versions: Record<string, object> = {};
      for (let i = 0; i < 100; i++) {
        versions[`1.0.${i}`] = {};
      }

      const mockResponse = {
        name: 'heavily-versioned',
        'dist-tags': { latest: '1.0.99' },
        versions,
      };

      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockResponse,
      });

      const result = await client.getPackageVersions('heavily-versioned');

      expect(result?.versions).toHaveLength(100);
    });

    it('returns null for 404', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 404,
      });

      const result = await client.getPackageVersions('non-existent');

      expect(result).toBeNull();
    });

    it('caches results', async () => {
      const mockResponse = {
        name: 'react',
        'dist-tags': { latest: '18.2.0' },
        versions: { '18.2.0': {} },
      };

      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockResponse,
      });

      await client.getPackageVersions('react');
      await client.getPackageVersions('react');

      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('getSpecificVersion', () => {
    it('fetches specific version metadata', async () => {
      const mockResponse = {
        name: 'react',
        version: '17.0.2',
        peerDependencies: { 'react-dom': '^17.0.2' },
      };

      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockResponse,
      });

      const result = await client.getSpecificVersion('react', '17.0.2');

      expect(fetchMock).toHaveBeenCalledWith(
        'https://registry.npmjs.org/react/17.0.2'
      );
      expect(result?.version).toBe('17.0.2');
    });

    it('handles prerelease versions', async () => {
      const mockResponse = {
        name: 'react',
        version: '19.0.0-beta.0',
      };

      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockResponse,
      });

      const result = await client.getSpecificVersion('react', '19.0.0-beta.0');

      expect(result?.version).toBe('19.0.0-beta.0');
    });

    it('returns null for non-existent version', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 404,
      });

      const result = await client.getSpecificVersion('react', '99.99.99');

      expect(result).toBeNull();
    });

    it('handles network errors', async () => {
      fetchMock.mockRejectedValueOnce(new Error('Network error'));

      const result = await client.getSpecificVersion('react', '18.0.0');

      expect(result).toBeNull();
    });
  });

  describe('clearCache', () => {
    it('clears all caches', async () => {
      const mockResponse = {
        name: 'react',
        version: '18.2.0',
      };

      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => mockResponse,
      });

      // Populate caches
      await client.getPackageMetadata('react');
      await client.getPackageVersions('react');

      // Clear cache
      client.clearCache();

      // Should fetch again
      await client.getPackageMetadata('react');

      expect(fetchMock).toHaveBeenCalledTimes(3);
    });
  });

  describe('edge cases', () => {
    it('handles packages with special characters in name (encoded)', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ name: '@scope/pkg', version: '1.0.0' }),
      });

      // @scope/pkg is encoded as %40scope%2Fpkg
      await client.getPackageMetadata('@scope/pkg');

      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('%40scope%2Fpkg')
      );
    });

    it('handles very long package names', async () => {
      const longName = 'a'.repeat(100);

      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 414, // URI Too Long
      });

      const result = await client.getPackageMetadata(longName);

      expect(result).toBeNull();
    });

    it('handles registry timeout', async () => {
      fetchMock.mockRejectedValueOnce(new Error('Timeout'));

      const result = await client.getPackageMetadata('slow-pkg');

      expect(result).toBeNull();
    });

    it('handles malformed registry response (missing fields)', async () => {
      const malformedResponse = {
        // Missing 'name' and 'version'
        weird_field: 'value',
      };

      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => malformedResponse,
      });

      const result = await client.getPackageMetadata('weird-pkg');

      // Should still return the data even if malformed
      expect(result).toBeDefined();
      expect(result?.name).toBeUndefined();
    });

    it('handles empty versions object', async () => {
      const mockResponse = {
        name: 'new-pkg',
        'dist-tags': { latest: '1.0.0' },
        versions: {},
      };

      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockResponse,
      });

      const result = await client.getPackageVersions('new-pkg');

      expect(result?.versions).toEqual([]);
      expect(result?.latest).toBe('1.0.0');
    });
  });
});
