// Dependency Resolution and Compatibility Logic
import { registry } from './registry.js';
import type {
  PackageMetadata,
  CompatibilityConflict,
  ResolvePackagesResult,
  CheckCompatibilityResult,
  CompatibilityIssue,
} from './types.js';

// Semver comparison helpers - exported for testing
export function parseSemver(version: string): { major: number; minor: number; patch: number; prerelease: string } | null {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)(?:-(.+))?$/);
  if (!match) return null;
  return {
    major: parseInt(match[1], 10),
    minor: parseInt(match[2], 10),
    patch: parseInt(match[3], 10),
    prerelease: match[4] || '',
  };
}

export function satisfiesRange(version: string, range: string): boolean {
  // Simplified semver range checking
  // Handles: ^x.y.z, ~x.y.z, >=x.y.z, x.y.z, || (OR) ranges, etc.
  
  const v = parseSemver(version);
  if (!v) return false;

  range = range.trim();

  // Handle || (OR) ranges - e.g., "^18.0.0 || ^19.0.0"
  if (range.includes('||')) {
    const subRanges = range.split('||').map(r => r.trim());
    return subRanges.some(subRange => satisfiesRange(version, subRange));
  }

  // Exact version
  if (/^\d+\.\d+\.\d+/.test(range) && !range.startsWith('^') && !range.startsWith('~') && !range.startsWith('>=') && !range.startsWith('>')) {
    return version.startsWith(range.replace(/\^|~|>=|>|</g, '').split(' ')[0]);
  }

  // ^x.y.z - compatible with major (also handles ^x.y as ^x.y.0)
  if (range.startsWith('^')) {
    let rangeBody = range.slice(1);
    // Pad partial versions: ^1.2 -> ^1.2.0, ^1 -> ^1.0.0
    if (/^\d+$/.test(rangeBody)) rangeBody += '.0.0';
    else if (/^\d+\.\d+$/.test(rangeBody)) rangeBody += '.0';
    const r = parseSemver(rangeBody);
    if (!r) return false;
    return v.major === r.major && (v.major !== 0 || (v.minor === r.minor && v.patch >= r.patch));
  }

  // ~x.y.z - compatible with minor (also handles ~x.y as ~x.y.0)
  if (range.startsWith('~')) {
    let rangeBody = range.slice(1);
    // Pad partial versions: ~1.2 -> ~1.2.0, ~1 -> ~1.0.0
    if (/^\d+$/.test(rangeBody)) rangeBody += '.0.0';
    else if (/^\d+\.\d+$/.test(rangeBody)) rangeBody += '.0';
    const r = parseSemver(rangeBody);
    if (!r) return false;
    return v.major === r.major && v.minor === r.minor && v.patch >= r.patch;
  }

  // >=x.y.z
  if (range.startsWith('>=')) {
    const r = parseSemver(range.slice(2));
    if (!r) return false;
    return v.major > r.major ||
      (v.major === r.major && v.minor > r.minor) ||
      (v.major === r.major && v.minor === r.minor && v.patch >= r.patch);
  }

  // >x.y.z
  if (range.startsWith('>') && !range.startsWith('>=')) {
    const r = parseSemver(range.slice(1));
    if (!r) return false;
    return v.major > r.major ||
      (v.major === r.major && v.minor > r.minor) ||
      (v.major === r.major && v.minor === r.minor && v.patch > r.patch);
  }

  // Wildcard or * - accepts anything
  if (range === '*' || range === 'x' || range === 'X') {
    return true;
  }

  // npm tag (like 'latest', 'next', 'beta')
  if (/^[a-zA-Z]/.test(range) && !range.match(/\d/)) {
    // Tags can't be satisfied by version strings, handled at lookup time
    return false;
  }

  return false;
}

export function checkEngineConstraint(version: string, constraint: string | undefined): boolean {
  if (!constraint) return true;
  // Simplified engine checking
  const v = parseSemver(version);
  if (!v) return true;

  // Handle >= constraint
  if (constraint.startsWith('>=')) {
    const c = parseSemver(constraint.slice(2));
    if (!c) return true;
    return v.major > c.major ||
      (v.major === c.major && v.minor >= c.minor);
  }

  return true;
}

export class Resolver {
  private resolvedPackages: Map<string, PackageMetadata> = new Map();
  private conflicts: CompatibilityConflict[] = [];
  private nodeVersion?: string;
  private npmVersion?: string;

  async resolvePackages(
    packages: Array<string | { name: string; version?: string }>,
    options: { node?: string; npm?: string } = {}
  ): Promise<ResolvePackagesResult> {
    this.resolvedPackages.clear();
    this.conflicts = [];
    this.nodeVersion = options.node;
    this.npmVersion = options.npm;

    const result: Record<string, string> = {};

    // First pass: resolve all packages in parallel with loading indicator
    console.error(`[resolver] Fetching metadata for ${packages.length} package(s)...`);
    const startTime = Date.now();

    const packagePromises = packages.map(async (pkg) => {
      const name = typeof pkg === 'string' ? pkg : pkg.name;
      const versionSpec = typeof pkg === 'string' ? undefined : pkg.version;

      console.error(`[resolver] Fetching ${name}...`);
      const metadata = versionSpec
        ? await registry.getSpecificVersion(name, versionSpec)
        : await registry.getPackageMetadata(name);

      if (!metadata) {
        return {
          name,
          error: true,
          required: versionSpec || 'latest',
          conflicts: [{ from: 'resolution', required: 'package not found' }],
        };
      }

      console.error(`[resolver] ✓ ${name}@${metadata.version}`);
      return { name, metadata, version: metadata.version };
    });

    const resolved = await Promise.all(packagePromises);
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.error(`[resolver] Fetched ${resolved.filter(r => !r.error).length} package(s) in ${elapsed}s`);

    // Process results
    for (const item of resolved) {
      if (item.error) {
        this.conflicts.push({
          package: item.name,
          required: item.required || 'latest',
          conflicts: item.conflicts || [],
        });
        continue;
      }
      this.resolvedPackages.set(item.name, item.metadata!);
      result[item.name] = `^${item.version}`;
    }

    // Second pass: check peer dependencies
    for (const [name, metadata] of this.resolvedPackages) {
      if (metadata.peerDependencies) {
        for (const [peerName, peerRange] of Object.entries(metadata.peerDependencies)) {
          const peerMetadata = this.resolvedPackages.get(peerName);

          if (peerMetadata) {
            // Check if resolved version satisfies peer range
            if (!satisfiesRange(peerMetadata.version, peerRange)) {
              this.conflicts.push({
                package: peerName,
                required: peerRange,
                conflicts: [{ from: name, required: peerRange }],
              });
            }
          } else {
            // Peer not in resolution set - check if it's a known package
            const latestPeer = await registry.getPackageMetadata(peerName);
            if (latestPeer) {
              if (!satisfiesRange(latestPeer.version, peerRange)) {
                // Peer dependency needs specific version
                const versions = await registry.getPackageVersions(peerName);
                if (versions) {
                  // Find compatible version
                  const compatibleVersion = versions.versions
                    .reverse()
                    .find(v => satisfiesRange(v, peerRange));

                  if (compatibleVersion) {
                    result[peerName] = `^${compatibleVersion}`;
                    const compatMetadata = await registry.getSpecificVersion(peerName, compatibleVersion);
                    if (compatMetadata) {
                      this.resolvedPackages.set(peerName, compatMetadata);
                    }
                  } else {
                    this.conflicts.push({
                      package: peerName,
                      required: peerRange,
                      conflicts: [{ from: name, required: peerRange }],
                    });
                  }
                }
              } else {
                result[peerName] = `^${latestPeer.version}`;
                this.resolvedPackages.set(peerName, latestPeer);
              }
            }
          }
        }
      }

      // Check engines
      if (this.nodeVersion && metadata.engines?.node) {
        if (!checkEngineConstraint(this.nodeVersion, metadata.engines.node)) {
          this.conflicts.push({
            package: name,
            required: metadata.engines.node,
            conflicts: [{ from: 'engines', required: `node ${this.nodeVersion}` }],
          });
        }
      }
    }

    return {
      packages: result,
      conflicts: this.conflicts,
      engines: {
        node: this.nodeVersion,
        npm: this.npmVersion,
      },
    };
  }

  async checkCompatibility(
    deps: {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
    },
    options: { node?: string; npm?: string } = {}
  ): Promise<CheckCompatibilityResult> {
    const outdated: CompatibilityIssue[] = [];
    const incompatible: CompatibilityIssue[] = [];
    const engineIssues: CompatibilityIssue[] = [];
    const suggested: Record<string, string> = {};

    const allDeps = {
      ...deps.dependencies,
      ...deps.devDependencies,
      ...deps.peerDependencies,
    };

    const depEntries = Object.entries(allDeps);
    console.error(`[resolver] Checking compatibility for ${depEntries.length} package(s)...`);
    const startTime = Date.now();

    // Fetch all metadata in parallel
    const depPromises = depEntries.map(async ([name, currentVersion]) => {
      console.error(`[resolver] Checking ${name}...`);
      const latest = await registry.getPackageMetadata(name);
      if (!latest) {
        console.error(`[resolver] ⚠ ${name} not found`);
        return null;
      }
      console.error(`[resolver] ✓ ${name}@${latest.version}`);
      return { name, currentVersion, latest };
    });

    const depResults = (await Promise.all(depPromises)).filter((r): r is NonNullable<typeof r> => r !== null);
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.error(`[resolver] Checked ${depResults.length} package(s) in ${elapsed}s`);

    // Process results
    for (const { name, currentVersion, latest } of depResults) {
      const latestV = latest.version;

      if (!satisfiesRange(latestV, currentVersion)) {
        outdated.push({
          package: name,
          current: currentVersion,
          latest: latestV,
          issue: 'outdated',
          message: `${name} ${currentVersion} -> ${latestV}`,
        });
        suggested[name] = `^${latestV}`;
      } else {
        suggested[name] = currentVersion;
      }

      // Check peer dependencies compatibility
      if (latest.peerDependencies) {
        for (const [peerName, peerRange] of Object.entries(latest.peerDependencies)) {
          const peerCurrent = allDeps[peerName];
          if (peerCurrent) {
            const peerVersion = peerCurrent.replace(/^[\^~>=<]+/, '');
            if (!satisfiesRange(peerVersion, peerRange)) {
              incompatible.push({
                package: peerName,
                current: peerCurrent,
                latest: peerVersion,
                issue: 'incompatible',
                message: `${name} requires ${peerName} ${peerRange}, but ${peerCurrent} is installed`,
              });
            }
          }
        }
      }

      // Check engine compatibility
      if (options.node && latest.engines?.node) {
        if (!checkEngineConstraint(options.node, latest.engines.node)) {
          engineIssues.push({
            package: name,
            current: currentVersion,
            latest: latestV,
            issue: 'engine_mismatch',
            message: `${name} requires node ${latest.engines.node}, but ${options.node} is specified`,
          });
        }
      }
    }

    return { outdated, incompatible, engineIssues, suggested };
  }
}

export const resolver = new Resolver();
