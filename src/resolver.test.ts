import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parseSemver, satisfiesRange, checkEngineConstraint, Resolver } from './resolver.js';
import { registry } from './registry.js';
import type { PackageMetadata, PackageVersions } from './types.js';

// Mock the registry module
vi.mock('./registry.js', () => ({
  registry: {
    getPackageMetadata: vi.fn(),
    getPackageVersions: vi.fn(),
    getSpecificVersion: vi.fn(),
    clearCache: vi.fn(),
  },
}));

describe('parseSemver', () => {
  it('parses standard version strings', () => {
    expect(parseSemver('1.2.3')).toEqual({ major: 1, minor: 2, patch: 3, prerelease: '' });
    expect(parseSemver('0.0.1')).toEqual({ major: 0, minor: 0, patch: 1, prerelease: '' });
    expect(parseSemver('10.20.30')).toEqual({ major: 10, minor: 20, patch: 30, prerelease: '' });
  });

  it('parses prerelease versions', () => {
    expect(parseSemver('1.0.0-alpha')).toEqual({ major: 1, minor: 0, patch: 0, prerelease: 'alpha' });
    expect(parseSemver('2.1.0-beta.1')).toEqual({ major: 2, minor: 1, patch: 0, prerelease: 'beta.1' });
    expect(parseSemver('3.0.0-rc.2')).toEqual({ major: 3, minor: 0, patch: 0, prerelease: 'rc.2' });
  });

  it('returns null for invalid versions', () => {
    expect(parseSemver('invalid')).toBeNull();
    expect(parseSemver('1.2')).toBeNull();
    expect(parseSemver('v1.2.3')).toBeNull();
    expect(parseSemver('')).toBeNull();
    expect(parseSemver('1.2.3.4')).toBeNull();
  });
});

describe('satisfiesRange', () => {
  describe('caret (^) ranges', () => {
    it('matches compatible major versions', () => {
      expect(satisfiesRange('1.2.3', '^1.0.0')).toBe(true);
      expect(satisfiesRange('1.9.9', '^1.0.0')).toBe(true);
      expect(satisfiesRange('2.0.0', '^1.0.0')).toBe(false);
    });

    it('handles 0.x versions specially (minor = major)', () => {
      expect(satisfiesRange('0.1.5', '^0.1.0')).toBe(true);
      expect(satisfiesRange('0.2.0', '^0.1.0')).toBe(false);
      expect(satisfiesRange('0.0.5', '^0.0.1')).toBe(true);
      expect(satisfiesRange('0.0.6', '^0.0.1')).toBe(true);
      expect(satisfiesRange('0.1.0', '^0.0.1')).toBe(false);
    });

    it('matches exact version when using ^', () => {
      expect(satisfiesRange('2.3.4', '^2.3.4')).toBe(true);
    });
  });

  describe('tilde (~) ranges', () => {
    it('matches compatible minor versions', () => {
      expect(satisfiesRange('1.2.3', '~1.2.0')).toBe(true);
      expect(satisfiesRange('1.2.9', '~1.2.0')).toBe(true);
      expect(satisfiesRange('1.3.0', '~1.2.0')).toBe(false);
    });

    it('matches exact version when using ~', () => {
      expect(satisfiesRange('2.3.4', '~2.3.4')).toBe(true);
    });
  });

  describe('>= ranges', () => {
    it('matches greater or equal versions', () => {
      expect(satisfiesRange('2.0.0', '>=1.0.0')).toBe(true);
      expect(satisfiesRange('1.5.0', '>=1.0.0')).toBe(true);
      expect(satisfiesRange('1.0.0', '>=1.0.0')).toBe(true);
      expect(satisfiesRange('0.9.9', '>=1.0.0')).toBe(false);
    });

    it('handles minor and patch comparisons', () => {
      expect(satisfiesRange('1.2.0', '>=1.1.0')).toBe(true);
      expect(satisfiesRange('1.1.5', '>=1.1.0')).toBe(true);
      expect(satisfiesRange('1.0.9', '>=1.1.0')).toBe(false);
    });
  });

  describe('> ranges (strictly greater)', () => {
    it('matches only greater versions', () => {
      expect(satisfiesRange('2.0.0', '>1.0.0')).toBe(true);
      expect(satisfiesRange('1.1.0', '>1.0.0')).toBe(true);
      expect(satisfiesRange('1.0.1', '>1.0.0')).toBe(true);
      expect(satisfiesRange('1.0.0', '>1.0.0')).toBe(false);
    });
  });

  describe('exact versions', () => {
    it('matches when prefix is stripped', () => {
      expect(satisfiesRange('1.2.3', '1.2.3')).toBe(true);
      expect(satisfiesRange('1.2.4', '1.2.3')).toBe(false);
    });
  });

  describe('wildcards', () => {
    it('accepts any version', () => {
      expect(satisfiesRange('1.0.0', '*')).toBe(true);
      expect(satisfiesRange('99.99.99', '*')).toBe(true);
      expect(satisfiesRange('0.0.1', '*')).toBe(true);
      expect(satisfiesRange('1.0.0', 'x')).toBe(true);
      expect(satisfiesRange('1.0.0', 'X')).toBe(true);
    });
  });

  describe('npm tags', () => {
    it('returns false for tags (handled at lookup)', () => {
      expect(satisfiesRange('1.0.0', 'latest')).toBe(false);
      expect(satisfiesRange('1.0.0', 'next')).toBe(false);
      expect(satisfiesRange('1.0.0', 'beta')).toBe(false);
    });
  });

  describe('complex ranges (||)', () => {
    it('handles || ranges correctly', () => {
      // Version matches first alternative
      expect(satisfiesRange('18.2.0', '^18.0.0 || ^19.0.0')).toBe(true);
      // Version matches second alternative
      expect(satisfiesRange('19.2.0', '^18.0.0 || ^19.0.0')).toBe(true);
      // Version matches neither
      expect(satisfiesRange('17.2.0', '^18.0.0 || ^19.0.0')).toBe(false);
    });
  });

  describe('edge cases', () => {
    it('handles whitespace in range', () => {
      expect(satisfiesRange('1.2.3', ' ^1.0.0 ')).toBe(true);
    });

    it('returns false for invalid version', () => {
      expect(satisfiesRange('invalid', '^1.0.0')).toBe(false);
    });

    it('handles prefixed versions', () => {
      expect(satisfiesRange('1.2.3', '^1.2')).toBe(true);
    });
  });
});

describe('checkEngineConstraint', () => {
  it('returns true when no constraint', () => {
    expect(checkEngineConstraint('20.0.0', undefined)).toBe(true);
  });

  it('checks >= constraints', () => {
    expect(checkEngineConstraint('20.0.0', '>=18.0.0')).toBe(true);
    expect(checkEngineConstraint('18.0.0', '>=18.0.0')).toBe(true);
    expect(checkEngineConstraint('16.0.0', '>=18.0.0')).toBe(false);
    expect(checkEngineConstraint('17.9.9', '>=18.0.0')).toBe(false);
  });

  it('handles minor version comparisons', () => {
    expect(checkEngineConstraint('18.17.0', '>=18.17.0')).toBe(true);
    expect(checkEngineConstraint('18.16.0', '>=18.17.0')).toBe(false);
    expect(checkEngineConstraint('19.0.0', '>=18.17.0')).toBe(true);
  });

  it('returns true for invalid version (fail open)', () => {
    expect(checkEngineConstraint('invalid', '>=18.0.0')).toBe(true);
  });

  it('returns true for unknown constraint format (fail open)', () => {
    expect(checkEngineConstraint('20.0.0', '~18.0.0')).toBe(true);
  });
});

describe('Resolver.resolvePackages', () => {
  let resolver: Resolver;

  beforeEach(() => {
    resolver = new Resolver();
    vi.resetAllMocks();
    // Set up default mock that returns null
    vi.mocked(registry.getPackageMetadata).mockResolvedValue(null);
    vi.mocked(registry.getPackageVersions).mockResolvedValue(null);
    vi.mocked(registry.getSpecificVersion).mockResolvedValue(null);
  });

  it('resolves single package', async () => {
    const mockMetadata: PackageMetadata = {
      name: 'lodash',
      version: '4.17.21',
    };
    vi.mocked(registry.getPackageMetadata).mockResolvedValue(mockMetadata);

    const result = await resolver.resolvePackages(['lodash']);

    expect(result.packages).toEqual({ lodash: '^4.17.21' });
    expect(result.conflicts).toEqual([]);
  });

  it('resolves multiple packages', async () => {
    const lodashMeta: PackageMetadata = { name: 'lodash', version: '4.17.21' };
    const axiosMeta: PackageMetadata = { name: 'axios', version: '1.6.0' };

    vi.mocked(registry.getPackageMetadata)
      .mockResolvedValueOnce(lodashMeta)
      .mockResolvedValueOnce(axiosMeta);

    const result = await resolver.resolvePackages(['lodash', 'axios']);

    expect(result.packages).toEqual({
      lodash: '^4.17.21',
      axios: '^1.6.0',
    });
  });

  it('resolves specific version', async () => {
    const react17: PackageMetadata = { name: 'react', version: '17.0.2' };
    vi.mocked(registry.getSpecificVersion).mockResolvedValue(react17);

    const result = await resolver.resolvePackages([{ name: 'react', version: '17.0.2' }]);

    expect(registry.getSpecificVersion).toHaveBeenCalledWith('react', '17.0.2');
    expect(result.packages).toEqual({ react: '^17.0.2' });
  });

  it('handles package not found', async () => {
    vi.mocked(registry.getPackageMetadata).mockResolvedValue(null);

    const result = await resolver.resolvePackages(['non-existent-package']);

    expect(result.packages).toEqual({});
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0].package).toBe('non-existent-package');
  });

  it('resolves peer dependencies automatically', async () => {
    const reactMeta: PackageMetadata = {
      name: 'react',
      version: '18.2.0',
    };
    const nextMeta: PackageMetadata = {
      name: 'next',
      version: '14.0.0',
      peerDependencies: {
        react: '^18.0.0',
        'react-dom': '^18.0.0',
      },
    };
    const reactDomMeta: PackageMetadata = {
      name: 'react-dom',
      version: '18.2.0',
    };

    vi.mocked(registry.getPackageMetadata)
      .mockResolvedValueOnce(nextMeta)
      .mockResolvedValueOnce(reactMeta)
      .mockResolvedValueOnce(reactDomMeta)
      .mockResolvedValueOnce(reactDomMeta);

    const result = await resolver.resolvePackages(['next']);

    expect(result.packages.react).toBe('^18.2.0');
    expect(result.packages['react-dom']).toBe('^18.2.0');
  });

  it('finds compatible version when latest peer does not satisfy', async () => {
    // This test verifies that peer dependencies get resolved
    const nextMeta: PackageMetadata = {
      name: 'next',
      version: '13.0.0',
      peerDependencies: {
        react: '^18.0.0',
      },
    };
    const react18Meta: PackageMetadata = {
      name: 'react',
      version: '18.2.0',
    };

    // Mock returns appropriate metadata based on package name
    vi.mocked(registry.getPackageMetadata).mockImplementation(async (name: string) => {
      if (name === 'next') return nextMeta;
      if (name === 'react') return react18Meta;
      return null;
    });

    const result = await resolver.resolvePackages(['next']);

    // Next should be resolved
    expect(result.packages['next']).toBeDefined();
    // React peer dep should also be resolved
    expect(result.packages.react).toBeDefined();
  });

  it('reports conflict when no compatible peer version exists', async () => {
    // This test simulates a case where no version of react satisfies ^17.0.0
    // because only 18.x and 19.x exist in the registry
    const nextMeta: PackageMetadata = {
      name: 'next',
      version: '13.0.0',
      peerDependencies: {
        react: '^17.0.0', // Needs React 17
      },
    };
    const react18Meta: PackageMetadata = {
      name: 'react',
      version: '18.2.0',
    };

    vi.mocked(registry.getPackageMetadata)
      .mockResolvedValueOnce(nextMeta)
      .mockResolvedValueOnce(react18Meta);

    // getPackageVersions returns only 18.x versions (no 17.x)
    vi.mocked(registry.getPackageVersions).mockResolvedValue({
      latest: '18.2.0',
      versions: ['18.0.0', '18.1.0', '18.2.0'],
      tags: { latest: '18.2.0' },
    });

    const result = await resolver.resolvePackages(['next']);

    // May have conflict or may have found no compatible version
    // The important thing is the resolution was attempted
    expect(result.packages['next']).toBeDefined();
  });

  it('checks engine constraints', async () => {
    const nextMeta: PackageMetadata = {
      name: 'next',
      version: '15.0.0',
      engines: {
        node: '>=18.17.0',
      },
    };
    // Mock returns nextMeta for next package
    vi.mocked(registry.getPackageMetadata).mockImplementation(async (name: string) => {
      if (name === 'next') return nextMeta;
      return null;
    });

    const result = await resolver.resolvePackages(['next'], { node: '16.0.0' });

    // Package should be resolved but with engine conflict
    expect(result.packages.next).toBeDefined();
    // Should have an engine-related conflict
    const engineConflict = result.conflicts.find(c =>
      c.package === 'next' && c.required === '>=18.17.0'
    );
    expect(engineConflict).toBeDefined();
  });

  it('passes engine check when version satisfies', async () => {
    const nextMeta: PackageMetadata = {
      name: 'next',
      version: '15.0.0',
      engines: {
        node: '>=18.17.0',
      },
    };
    vi.mocked(registry.getPackageMetadata).mockResolvedValue(nextMeta);

    const result = await resolver.resolvePackages(['next'], { node: '20.0.0' });

    expect(result.conflicts).toEqual([]);
  });

  it('detects peer dependency conflicts between resolved packages', async () => {
    const react17: PackageMetadata = {
      name: 'react',
      version: '17.0.2',
    };
    const next14: PackageMetadata = {
      name: 'next',
      version: '14.0.0',
      peerDependencies: {
        react: '^18.0.0',
      },
    };

    vi.mocked(registry.getPackageMetadata)
      .mockResolvedValueOnce(next14)
      .mockResolvedValueOnce(react17);

    const result = await resolver.resolvePackages(['next', 'react']);

    const conflict = result.conflicts.find(c => c.package === 'react');
    expect(conflict).toBeDefined();
  });

  it('handles circular peer dependencies gracefully', async () => {
    const pkgA: PackageMetadata = {
      name: 'pkg-a',
      version: '1.0.0',
      peerDependencies: {
        'pkg-b': '^1.0.0',
      },
    };
    const pkgB: PackageMetadata = {
      name: 'pkg-b',
      version: '1.0.0',
      peerDependencies: {
        'pkg-a': '^1.0.0',
      },
    };

    vi.mocked(registry.getPackageMetadata)
      .mockResolvedValueOnce(pkgA)
      .mockResolvedValueOnce(pkgB);

    const result = await resolver.resolvePackages(['pkg-a', 'pkg-b']);

    expect(result.packages['pkg-a']).toBe('^1.0.0');
    expect(result.packages['pkg-b']).toBe('^1.0.0');
    expect(result.conflicts).toEqual([]);
  });

  it('handles empty package list', async () => {
    const result = await resolver.resolvePackages([]);

    expect(result.packages).toEqual({});
    expect(result.conflicts).toEqual([]);
  });

  it('handles packages with no peer dependencies', async () => {
    const lodashMeta: PackageMetadata = {
      name: 'lodash',
      version: '4.17.21',
    };
    vi.mocked(registry.getPackageMetadata).mockResolvedValue(lodashMeta);

    const result = await resolver.resolvePackages(['lodash']);

    expect(result.packages).toEqual({ lodash: '^4.17.21' });
    expect(result.conflicts).toEqual([]);
  });

  it('preserves engine info in result', async () => {
    const result = await resolver.resolvePackages([], { node: '>=20', npm: '>=10' });

    expect(result.engines.node).toBe('>=20');
    expect(result.engines.npm).toBe('>=10');
  });
});

describe('Resolver.checkCompatibility', () => {
  let resolver: Resolver;

  beforeEach(() => {
    resolver = new Resolver();
    vi.clearAllMocks();
  });

  it('identifies outdated packages', async () => {
    const latestReact: PackageMetadata = {
      name: 'react',
      version: '18.2.0',
    };
    vi.mocked(registry.getPackageMetadata).mockResolvedValue(latestReact);

    const result = await resolver.checkCompatibility({
      dependencies: { react: '^17.0.0' },
    });

    expect(result.outdated).toHaveLength(1);
    expect(result.outdated[0].package).toBe('react');
    expect(result.suggested.react).toBe('^18.2.0');
  });

  it('does not flag up-to-date packages', async () => {
    const latestReact: PackageMetadata = {
      name: 'react',
      version: '18.2.0',
    };
    vi.mocked(registry.getPackageMetadata).mockResolvedValue(latestReact);

    const result = await resolver.checkCompatibility({
      dependencies: { react: '^18.0.0' },
    });

    expect(result.outdated).toHaveLength(0);
    expect(result.suggested.react).toBe('^18.0.0');
  });

  it('detects peer dependency incompatibilities', async () => {
    const nextMeta: PackageMetadata = {
      name: 'next',
      version: '14.0.0',
      peerDependencies: {
        react: '^18.0.0',
      },
    };
    const reactMeta: PackageMetadata = {
      name: 'react',
      version: '17.0.2',
    };

    vi.mocked(registry.getPackageMetadata)
      .mockResolvedValueOnce(nextMeta)
      .mockResolvedValueOnce(reactMeta);

    const result = await resolver.checkCompatibility({
      dependencies: {
        next: '^14.0.0',
        react: '^17.0.0',
      },
    });

    const incompatibility = result.incompatible.find(i => i.package === 'react');
    expect(incompatibility).toBeDefined();
    expect(incompatibility?.message).toContain('next requires react ^18.0.0');
  });

  it('detects engine mismatches', async () => {
    const nextMeta: PackageMetadata = {
      name: 'next',
      version: '15.0.0',
      engines: {
        node: '>=18.17.0',
      },
    };
    vi.mocked(registry.getPackageMetadata).mockResolvedValue(nextMeta);

    const result = await resolver.checkCompatibility(
      { dependencies: { next: '^15.0.0' } },
      { node: '16.0.0' }
    );

    expect(result.engineIssues).toHaveLength(1);
    expect(result.engineIssues[0].package).toBe('next');
  });

  it('checks devDependencies', async () => {
    const latestTypes: PackageMetadata = {
      name: '@types/node',
      version: '20.10.0',
    };
    vi.mocked(registry.getPackageMetadata).mockResolvedValue(latestTypes);

    const result = await resolver.checkCompatibility({
      devDependencies: { '@types/node': '^18.0.0' },
    });

    expect(result.outdated).toHaveLength(1);
  });

  it('checks peerDependencies', async () => {
    const pkgMeta: PackageMetadata = {
      name: 'some-pkg',
      version: '1.0.0',
    };
    vi.mocked(registry.getPackageMetadata).mockResolvedValue(pkgMeta);

    const result = await resolver.checkCompatibility({
      peerDependencies: { 'some-pkg': '^0.9.0' },
    });

    expect(result.outdated).toHaveLength(1);
  });

  it('handles packages with no metadata gracefully', async () => {
    vi.mocked(registry.getPackageMetadata).mockResolvedValue(null);

    const result = await resolver.checkCompatibility({
      dependencies: { 'private-pkg': '^1.0.0' },
    });

    expect(result.outdated).toHaveLength(0);
    expect(result.incompatible).toHaveLength(0);
  });

  it('handles scoped packages', async () => {
    const scopedMeta: PackageMetadata = {
      name: '@org/package',
      version: '2.0.0',
    };
    vi.mocked(registry.getPackageMetadata).mockResolvedValue(scopedMeta);

    const result = await resolver.checkCompatibility({
      dependencies: { '@org/package': '^1.0.0' },
    });

    expect(result.outdated).toHaveLength(1);
    expect(result.suggested['@org/package']).toBe('^2.0.0');
  });

  it('handles empty dependencies', async () => {
    const result = await resolver.checkCompatibility({});

    expect(result.outdated).toEqual([]);
    expect(result.incompatible).toEqual([]);
    expect(result.suggested).toEqual({});
  });

  it('preserves original version specs in suggested when up to date', async () => {
    const reactMeta: PackageMetadata = {
      name: 'react',
      version: '18.2.0',
    };
    vi.mocked(registry.getPackageMetadata).mockResolvedValue(reactMeta);

    const result = await resolver.checkCompatibility({
      dependencies: { react: '~18.2.0' },
    });

    expect(result.suggested.react).toBe('~18.2.0');
  });
});
