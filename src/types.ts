// Shared types for llm-pkg-resolver

export interface PackageMetadata {
  name: string;
  version: string;
  description?: string;
  engines?: {
    node?: string;
    npm?: string;
  };
  peerDependencies?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  dist?: {
    tarball: string;
    shasum: string;
    integrity: string;
  };
}

export interface PackageVersions {
  latest: string;
  versions: string[];
  tags: Record<string, string>;
}

export interface ResolvedPackage {
  name: string;
  version: string;
  latestVersion: string;
  engines?: PackageMetadata['engines'];
  peerDependencies?: Record<string, string>;
}

export interface CompatibilityConflict {
  package: string;
  required: string;
  conflicts: Array<{
    from: string;
    required: string;
  }>;
}

export interface ResolvePackagesInput {
  packages: Array<string | { name: string; version?: string }>;
  node?: string;
  npm?: string;
}

export interface ResolvePackagesResult {
  packages: Record<string, string>;
  conflicts: CompatibilityConflict[];
  engines: {
    node?: string;
    npm?: string;
  };
}

export interface GetLatestVersionInput {
  package: string;
}

export interface GetLatestVersionResult extends PackageMetadata {}

export interface CheckCompatibilityInput {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  node?: string;
  npm?: string;
}

export interface CompatibilityIssue {
  package: string;
  current: string;
  latest: string;
  issue: 'outdated' | 'incompatible' | 'engine_mismatch';
  message: string;
}

export interface CheckCompatibilityResult {
  outdated: CompatibilityIssue[];
  incompatible: CompatibilityIssue[];
  engineIssues: CompatibilityIssue[];
  suggested: Record<string, string>;
}
