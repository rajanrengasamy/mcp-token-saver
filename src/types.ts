export interface TokenSaverConfig {
  projectRoot: string;
  ignorePatterns: string[];
}

export interface ParsedFileInfo {
  imports: string[];
  exports: string[];
}

export interface GraphNode {
  filePath: string;
  dependencies: Set<string>;
  exports: Set<string>;
  updatedAt: number;
}

export interface FileContext {
  requestedFile: {
    path: string;
    content: string;
  };
  directDependencies: Array<{
    path: string;
    content: string;
  }>;
}

export interface ProjectTreeResult {
  root: string;
  maxDepth: number;
  maxEntries: number;
  truncated: boolean;
  lines: string[];
}
