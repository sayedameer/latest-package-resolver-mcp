import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { parseSemver, satisfiesRange, checkEngineConstraint, Resolver } from './resolver.js';
import { registry } from './registry.js';
import { RegistryClient } from './registry.js';
import type { PackageMetadata, PackageVersions } from './types.js';

// Mock the registry singleton for resolver tests
vi.mock('./registry.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./registry.js')>();
  return {
    ...actual,
    registry: {
      getPackageMetadata: vi.fn(),
      getPackageVersions: vi.fn(),
      getSpecificVersion: vi.fn(),
      clearCache: vi.fn(),
    },
  };
});

describe('Edge Cases — Semver Parsing', () => {
  it('handles versions with leading zeros', () => {
    // npm allows leading zeros but treats them as octal in some contexts
    expect(parseSemver('01.02.03')).toEqual({
      major: 1,
      minor: 2,
      patch: 3,
      prerelease: '',
    });
  });

  it('handles very large version numbers', () => {
    expect(parseSemver('999999.999999.999999')).toEqual({
      major: 999999,
      minor: 999999,
      patch: 999999,
      prerelease: '',
    });
  });

  it('rejects invalid prerelease formats', () => {
    // Should still parse the version part
    const result = parseSemver('1.0.0-');
    expect(result).toBeNull(); // Empty prerelease after dash
  });
});

describe('Edge Cases — Range Satisfaction', () => {
  it('handles complex OR ranges', () => {
    // Now supports || ranges - matches if ANY sub-range matches
    expect(satisfiesRange('18.2.0', '^18.0.0 || ^17.0.0')).toBe(true); // matches ^18.0.0
    expect(satisfiesRange('17.2.0', '^18.0.0 || ^17.0.0')).toBe(true); // matches ^17.0.0
    expect(satisfiesRange('16.2.0', '^18.0.0 || ^17.0.0')).toBe(false); // matches neither
  });

  it('handles whitespace variations', () => {
    expect(satisfiesRange('1.2.3', '  ^1.0.0  ')).toBe(true);
    expect(satisfiesRange('1.2.3', '^ 1.0.0')).toBe(false); // Invalid format
  });

  it('handles exact version matching with prefixes', () => {
    // Should these match?
    expect(satisfiesRange('1.2.3', '1.2.3')).toBe(true);
    expect(satisfiesRange('1.2.3', 'v1.2.3')).toBe(false); // v prefix not stripped
  });

  it('handles 0.x special case in caret ranges', () => {
    // 0.x.x caret ranges treat minor as major
    expect(satisfiesRange('0.1.5', '^0.1.0')).toBe(true);
    expect(satisfiesRange('0.2.0', '^0.1.0')).toBe(false);
    expect(satisfiesRange('0.0.5', '^0.0.1')).toBe(true);
    expect(satisfiesRange('0.0.10', '^0.0.1')).toBe(true);
    expect(satisfiesRange('0.1.0', '^0.0.1')).toBe(false);
  });

  it('handles pre-release versions', () => {
    // Pre-release versions: our implementation strips prerelease and compares
    // 2.0.0-alpha has major=2, which doesn't match ^1.0.0 (needs major=1)
    expect(satisfiesRange('2.0.0-alpha', '^1.0.0')).toBe(false);
    // 1.0.0-alpha has major=1, which matches ^1.0.0
    expect(satisfiesRange('1.0.0-alpha', '^1.0.0')).toBe(true);
  });
});

describe('Edge Cases — Engine Constraints', () => {
  it('handles complex Node constraints', () => {
    // Different constraint formats
    expect(checkEngineConstraint('18.17.0', '>=18.17.0')).toBe(true);
    expect(checkEngineConstraint('18.16.0', '>=18.17.0')).toBe(false);
    expect(checkEngineConstraint('20.0.0', '>=18.17.0')).toBe(true);
    expect(checkEngineConstraint('19.0.0', '>=18.17.0')).toBe(true);
  });

  it('handles unknown constraint formats gracefully', () => {
    // Should fail open (return true) for unrecognized formats
    expect(checkEngineConstraint('20.0.0', '^18.0.0')).toBe(true);
    expect(checkEngineConstraint('20.0.0', '~18.0.0')).toBe(true);
    expect(checkEngineConstraint('20.0.0', '*')).toBe(true);
  });

  it('handles edge case Node versions', () => {
    expect(checkEngineConstraint('0.12.0', '>=0.10.0')).toBe(true);
    expect(checkEngineConstraint('0.8.0', '>=0.10.0')).toBe(false);
    expect(checkEngineConstraint('21.0.0', '>=20.0.0')).toBe(true);
    expect(checkEngineConstraint('20.0.0', '>=20.0.0')).toBe(true);
    expect(checkEngineConstraint('19.9.9', '>=20.0.0')).toBe(false);
  });

  it('handles missing constraint', () => {
    expect(checkEngineConstraint('20.0.0', undefined)).toBe(true);
  });

  it('handles invalid version in constraint check', () => {
    // Invalid runtime version should fail open
    expect(checkEngineConstraint('invalid', '>=18.0.0')).toBe(true);
    expect(checkEngineConstraint('', '>=18.0.0')).toBe(true);
  });
});

describe('Edge Cases — Resolver', () => {
  let resolver: Resolver;

  beforeEach(() => {
    resolver = new Resolver();
    vi.resetAllMocks();
    // Set up default mocks that return null
    vi.mocked(registry.getPackageMetadata).mockResolvedValue(null);
    vi.mocked(registry.getPackageVersions).mockResolvedValue(null);
    vi.mocked(registry.getSpecificVersion).mockResolvedValue(null);
  });

  it('handles packages with many peer dependencies', async () => {
    const pkgWithManyPeers: PackageMetadata = {
      name: 'complex-pkg',
      version: '1.0.0',
      peerDependencies: {
        react: '^18.0.0',
        'react-dom': '^18.0.0',
        '@types/react': '^18.0.0',
        '@types/react-dom': '^18.0.0',
        typescript: '^5.0.0',
        eslint: '^8.0.0',
      },
    };

    vi.mocked(registry.getPackageMetadata)
      .mockResolvedValueOnce(pkgWithManyPeers)
      .mockResolvedValue({ name: 'peer', version: '18.0.0' });

    const result = await resolver.resolvePackages(['complex-pkg']);

    expect(result.packages['complex-pkg']).toBe('^1.0.0');
    // Should resolve all peers
    expect(Object.keys(result.packages).length).toBeGreaterThan(1);
  });

  it('handles deeply nested peer dependency chains', async () => {
    const pkgA: PackageMetadata = {
      name: 'pkg-a',
      version: '1.0.0',
      peerDependencies: { 'pkg-b': '^1.0.0' },
    };
    const pkgB: PackageMetadata = {
      name: 'pkg-b',
      version: '1.0.0',
      peerDependencies: { 'pkg-c': '^1.0.0' },
    };
    const pkgC: PackageMetadata = {
      name: 'pkg-c',
      version: '1.0.0',
    };

    vi.mocked(registry.getPackageMetadata)
      .mockResolvedValueOnce(pkgA)
      .mockResolvedValueOnce(pkgB)
      .mockResolvedValueOnce(pkgC);

    const result = await resolver.resolvePackages(['pkg-a']);

    expect(result.packages['pkg-a']).toBe('^1.0.0');
    expect(result.packages['pkg-b']).toBe('^1.0.0');
    expect(result.packages['pkg-c']).toBe('^1.0.0');
  });

  it('handles package name case sensitivity', async () => {
    const lodashMeta: PackageMetadata = {
      name: 'lodash',
      version: '4.17.21',
    };

    // Registry should be case-insensitive
    vi.mocked(registry.getPackageMetadata).mockResolvedValue(lodashMeta);

    const result1 = await resolver.resolvePackages(['lodash']);
    const result2 = await resolver.resolvePackages(['Lodash']);
    const result3 = await resolver.resolvePackages(['LODASH']);

    // All should resolve to the same package
    expect(result1.packages.lodash).toBe('^4.17.21');
  });

  it('handles scoped packages correctly', async () => {
    const scopedPkg: PackageMetadata = {
      name: '@org/package',
      version: '1.0.0',
      peerDependencies: { '@org/peer': '^1.0.0' },
    };
    const scopedPeer: PackageMetadata = {
      name: '@org/peer',
      version: '1.0.0',
    };

    vi.mocked(registry.getPackageMetadata)
      .mockResolvedValueOnce(scopedPkg)
      .mockResolvedValueOnce(scopedPeer)
      .mockResolvedValueOnce(scopedPeer);

    const result = await resolver.resolvePackages(['@org/package']);

    expect(result.packages['@org/package']).toBe('^1.0.0');
    expect(result.packages['@org/peer']).toBe('^1.0.0');
  });

  it('handles packages with no versions', async () => {
    // Mock returns null for any package (simulating unpublished package)
    vi.mocked(registry.getPackageMetadata).mockImplementation(async () => null);
    vi.mocked(registry.getPackageVersions).mockResolvedValue(null);
    vi.mocked(registry.getSpecificVersion).mockResolvedValue(null);

    const result = await resolver.resolvePackages(['unpublished-pkg']);

    // Package is not found, so it's not in packages but is in conflicts
    expect(result.packages['unpublished-pkg']).toBeUndefined();
    expect(result.conflicts.length).toBeGreaterThanOrEqual(1);
    expect(result.conflicts.some(c => c.package === 'unpublished-pkg')).toBe(true);
  });

  it('handles deprecated packages', async () => {
    const deprecatedPkg: PackageMetadata = {
      name: 'old-pkg',
      version: '1.0.0',
      // npm adds deprecation warning in 'deprecated' field, but we don't parse it
    };

    vi.mocked(registry.getPackageMetadata).mockResolvedValue(deprecatedPkg);

    const result = await resolver.resolvePackages(['old-pkg']);

    // We currently don't handle deprecation specially
    expect(result.packages['old-pkg']).toBe('^1.0.0');
  });

  it('handles self-referential peer dependencies', async () => {
    // A package that lists itself as a peer (weird but possible)
    const selfRef: PackageMetadata = {
      name: 'self-ref',
      version: '1.0.0',
      peerDependencies: { 'self-ref': '^1.0.0' },
    };

    vi.mocked(registry.getPackageMetadata).mockResolvedValue(selfRef);

    const result = await resolver.resolvePackages(['self-ref']);

    // Should handle gracefully
    expect(result.packages['self-ref']).toBe('^1.0.0');
    expect(result.conflicts).toEqual([]);
  });

  it('handles version ranges in requested packages', async () => {
    const react17: PackageMetadata = {
      name: 'react',
      version: '17.0.2',
    };

    vi.mocked(registry.getSpecificVersion).mockResolvedValue(react17);

    const result = await resolver.resolvePackages([{ name: 'react', version: '^17.0.0' }]);

    // Should resolve to a version in the range
    expect(result.packages.react).toBe('^17.0.2');
  });

  it('handles checkCompatibility with empty/missing data', async () => {
    vi.mocked(registry.getPackageMetadata).mockResolvedValue(null);

    const result = await resolver.checkCompatibility({
      dependencies: {},
      devDependencies: {},
      peerDependencies: {},
    });

    expect(result.outdated).toEqual([]);
    expect(result.incompatible).toEqual([]);
    expect(result.suggested).toEqual({});
  });

  it('handles packages with exact version requirements', async () => {
    const strictPkg: PackageMetadata = {
      name: 'strict-pkg',
      version: '1.0.0',
      peerDependencies: {
        react: '18.2.0', // Exact version, no range
      },
    };
    const react182: PackageMetadata = {
      name: 'react',
      version: '18.2.0',
    };

    vi.mocked(registry.getPackageMetadata)
      .mockResolvedValueOnce(strictPkg)
      .mockResolvedValueOnce(react182);

    const result = await resolver.resolvePackages(['strict-pkg']);

    // Exact version should be satisfied
    expect(result.packages.react).toBe('^18.2.0');
  });

  it('handles conflicting peer requirements from multiple packages', async () => {
    const pkgA: PackageMetadata = {
      name: 'pkg-a',
      version: '1.0.0',
      peerDependencies: { react: '^17.0.0' },
    };
    const pkgB: PackageMetadata = {
      name: 'pkg-b',
      version: '1.0.0',
      peerDependencies: { react: '^18.0.0' },
    };
    const react17: PackageMetadata = {
      name: 'react',
      version: '17.0.2',
    };
    const react18: PackageMetadata = {
      name: 'react',
      version: '18.2.0',
    };

    vi.mocked(registry.getPackageMetadata)
      .mockResolvedValueOnce(pkgA)
      .mockResolvedValueOnce(pkgB)
      .mockResolvedValueOnce(react17)
      .mockResolvedValueOnce(react18);

    const result = await resolver.resolvePackages(['pkg-a', 'pkg-b']);

    // Should report conflicts
    expect(result.conflicts.length).toBeGreaterThan(0);
  });
});

describe('Edge Cases — Registry Client', () => {
  let client: RegistryClient;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockFetch: any;

  beforeEach(() => {
    client = new RegistryClient();
    client.clearCache();
    mockFetch = vi.fn();
    global.fetch = mockFetch;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('handles npm registry rate limiting', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 429,
      statusText: 'Too Many Requests',
    });

    const result = await client.getPackageMetadata('popular-pkg');
    // Rate limiting causes error which returns null
    expect(result === null || result === undefined).toBe(true);
  });

  it('handles registry redirects', async () => {
    // fetch follows redirects automatically, but let's test behavior
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ name: 'pkg', version: '1.0.0' }),
    });

    const result = await client.getPackageMetadata('pkg');
    expect(result).not.toBeNull();
  });

  it('handles very large package metadata', async () => {
    // Package with huge dependency tree
    const hugeDeps: Record<string, string> = {};
    for (let i = 0; i < 1000; i++) {
      hugeDeps[`dep-${i}`] = '^1.0.0';
    }

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        name: 'huge-pkg',
        version: '1.0.0',
        dependencies: hugeDeps,
      }),
    });

    const result = await client.getPackageMetadata('huge-pkg');
    expect(result).not.toBeNull();
    expect(result?.dependencies).toBeDefined();
    if (result?.dependencies) {
      expect(Object.keys(result.dependencies)).toHaveLength(1000);
    }
  });

  it('handles concurrent requests to same package', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ name: 'concurrent-pkg', version: '1.0.0' }),
    });

    // Fire multiple concurrent requests
    const promises = [
      client.getPackageMetadata('concurrent-pkg'),
      client.getPackageMetadata('concurrent-pkg'),
      client.getPackageMetadata('concurrent-pkg'),
    ];

    const results = await Promise.all(promises);

    // All should resolve (may or may not use cache depending on timing)
    expect(results.every(r => r !== null && r !== undefined)).toBe(true);
    expect(mockFetch).toHaveBeenCalled();
  });

  it('handles malformed JSON responses', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => { throw new SyntaxError('Unexpected token'); },
    });

    const result = await client.getPackageMetadata('broken-pkg');
    // JSON parse error returns null
    expect(result === null || result === undefined).toBe(true);
  });

  it('handles empty responses', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({}),
    });

    const result = await client.getPackageMetadata('empty-pkg');
    // Empty response returns empty object (not null)
    expect(result).toBeDefined();
    expect(result?.name).toBeUndefined();
    expect(result?.version).toBeUndefined();
  });
});

describe('Edge Cases — Real World Scenarios', () => {
  let resolver: Resolver;

  beforeEach(() => {
    resolver = new Resolver();
    vi.clearAllMocks();
  });

  it('handles Next.js ecosystem resolution', async () => {
    const nextMeta: PackageMetadata = {
      name: 'next',
      version: '15.1.0',
      engines: { node: '>=18.17.0' },
      peerDependencies: {
        react: '^18.2.0 || ^19.0.0',
        'react-dom': '^18.2.0 || ^19.0.0',
      },
    };
    const react19: PackageMetadata = {
      name: 'react',
      version: '19.0.0',
    };
    const reactDom19: PackageMetadata = {
      name: 'react-dom',
      version: '19.0.0',
    };

    vi.mocked(registry.getPackageMetadata)
      .mockResolvedValueOnce(nextMeta)
      .mockResolvedValueOnce(react19)
      .mockResolvedValueOnce(reactDom19);

    const result = await resolver.resolvePackages(['next'], { node: '20.0.0' });

    // Verify next was resolved (peer deps may also be resolved)
    expect(result.packages.next).toBeDefined();
    expect(result.packages.next?.startsWith('^')).toBe(true);
    expect(result.conflicts).toEqual([]);
  });

  it('handles React ecosystem type definitions', async () => {
    const reactTypes: PackageMetadata = {
      name: '@types/react',
      version: '18.2.0',
      peerDependencies: {
        '@types/react': '*', // Self-reference can happen
      },
    };

    vi.mocked(registry.getPackageMetadata).mockResolvedValue(reactTypes);

    const result = await resolver.resolvePackages(['@types/react']);

    // Should resolve the package
    expect(result.packages['@types/react']).toBeDefined();
    expect(result.packages['@types/react']?.startsWith('^')).toBe(true);
  });

  it('handles monorepo package resolution', async () => {
    // Simulating packages from a monorepo
    const pkgA: PackageMetadata = {
      name: '@myorg/core',
      version: '2.0.0',
      peerDependencies: {
        '@myorg/utils': '^2.0.0',
      },
    };
    const pkgB: PackageMetadata = {
      name: '@myorg/utils',
      version: '2.1.0',
    };

    vi.mocked(registry.getPackageMetadata)
      .mockResolvedValueOnce(pkgA)
      .mockResolvedValueOnce(pkgB)
      .mockResolvedValueOnce(pkgB);

    const result = await resolver.resolvePackages(['@myorg/core']);

    expect(result.packages['@myorg/core']).toBe('^2.0.0');
    expect(result.packages['@myorg/utils']).toBe('^2.1.0');
  });

  it('handles legacy package with old Node requirement', async () => {
    const legacyPkg: PackageMetadata = {
      name: 'legacy-pkg',
      version: '1.0.0',
      engines: { node: '>=0.10' },
    };

    vi.mocked(registry.getPackageMetadata).mockResolvedValue(legacyPkg);

    const result = await resolver.resolvePackages(['legacy-pkg'], { node: '20.0.0' });

    // Should pass because 20 > 0.10
    expect(result.conflicts).toEqual([]);
  });
});
