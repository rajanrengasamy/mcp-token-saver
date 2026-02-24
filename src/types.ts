export interface TokenSaverConfig {
  projectRoot: string;
  ignorePatterns: string[];
}

export type SymbolType = "function" | "class" | "interface" | "const";

export interface ExportedSymbol {
  name: string;
  type: SymbolType;
  line: number;
}

export interface ParsedFileInfo {
  imports: string[];
  exports: string[];
  symbols: ExportedSymbol[];
}

export interface GraphNode {
  filePath: string;
  dependencies: Set<string>;
  exports: Set<string>;
  symbols: ExportedSymbol[];
  hash: string;
  tokenEstimate: number;
  contentLength: number;
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

export interface IncludedContextFile {
  path: string;
  content: string;
  tokens: number;
  depth: number;
}

export interface ExcludedContextFile {
  path: string;
  reason: string;
  tokens: number;
  depth: number;
}

export interface TokenAwareContextResult {
  requestedPath: string;
  maxTokens: number;
  totalTokens: number;
  includedFiles: IncludedContextFile[];
  excludedFiles: ExcludedContextFile[];
  truncated: boolean;
}

export interface SearchResult {
  filePath: string;
  score: number;
  snippet: string;
}

export interface SearchResponse {
  query: string;
  maxResults: number;
  maxTokens: number;
  totalMatches: number;
  truncated: boolean;
  results: Array<{
    path: string;
    score: number;
    snippet: string;
    tokens: number;
  }>;
}

export interface SymbolMatch {
  path: string;
  line: number;
  type: SymbolType;
  name: string;
}

export interface StatsResult {
  filesIndexed: number;
  totalTokens: number;
  largestFiles: Array<{
    path: string;
    tokens: number;
    bytes: number;
  }>;
  languageBreakdown: Record<string, number>;
}

export interface ProjectTreeResult {
  root: string;
  maxDepth: number;
  maxEntries: number;
  truncated: boolean;
  lines: string[];
}

export interface IndexingStats {
  totalFiles: number;
  parsedFiles: number;
  skippedFiles: number;
}
