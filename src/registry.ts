// NPM Registry API Client
import type { PackageMetadata, PackageVersions } from './types.js';

const NPM_REGISTRY = 'https://registry.npmjs.org';

export class RegistryClient {
  private cache: Map<string, PackageMetadata> = new Map();
  private versionsCache: Map<string, PackageVersions> = new Map();

  async getPackageMetadata(name: string): Promise<PackageMetadata | null> {
    const cacheKey = name.toLowerCase();
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey)!;
    }

    try {
      const response = await fetch(`${NPM_REGISTRY}/${encodeURIComponent(name)}/latest`);
      if (!response.ok) {
        if (response.status === 404) {
          return null;
        }
        throw new Error(`Registry error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      const metadata: PackageMetadata = {
        name: data.name,
        version: data.version,
        description: data.description,
        engines: data.engines,
        peerDependencies: data.peerDependencies,
        dependencies: data.dependencies,
        devDependencies: data.devDependencies,
        dist: data.dist,
      };

      this.cache.set(cacheKey, metadata);
      return metadata;
    } catch (error) {
      console.error(`Failed to fetch metadata for ${name}:`, error);
      return null;
    }
  }

  async getPackageVersions(name: string): Promise<PackageVersions | null> {
    const cacheKey = name.toLowerCase();
    if (this.versionsCache.has(cacheKey)) {
      return this.versionsCache.get(cacheKey)!;
    }

    try {
      const response = await fetch(`${NPM_REGISTRY}/${encodeURIComponent(name)}`);
      if (!response.ok) {
        if (response.status === 404) {
          return null;
        }
        throw new Error(`Registry error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      const versions = Object.keys(data.versions || {});
      const tags = data['dist-tags'] || {};

      const result: PackageVersions = {
        latest: tags.latest || versions[versions.length - 1],
        versions,
        tags,
      };

      this.versionsCache.set(cacheKey, result);
      return result;
    } catch (error) {
      console.error(`Failed to fetch versions for ${name}:`, error);
      return null;
    }
  }

  async getSpecificVersion(name: string, version: string): Promise<PackageMetadata | null> {
    try {
      const response = await fetch(`${NPM_REGISTRY}/${encodeURIComponent(name)}/${encodeURIComponent(version)}`);
      if (!response.ok) {
        return null;
      }

      const data = await response.json();
      return {
        name: data.name,
        version: data.version,
        description: data.description,
        engines: data.engines,
        peerDependencies: data.peerDependencies,
        dependencies: data.dependencies,
        devDependencies: data.devDependencies,
        dist: data.dist,
      };
    } catch (error) {
      console.error(`Failed to fetch ${name}@${version}:`, error);
      return null;
    }
  }

  clearCache(): void {
    this.cache.clear();
    this.versionsCache.clear();
  }
}

export const registry = new RegistryClient();
