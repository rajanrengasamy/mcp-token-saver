import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import chokidar, { FSWatcher } from "chokidar";
import { minimatch } from "minimatch";
import { hashContent } from "./fileHash.js";
import { parseSourceForDeps } from "./parser.js";
import { BM25Searcher } from "./search.js";
import {
  FileContext,
  GraphNode,
  IndexingStats,
  ProjectTreeResult,
  SearchResponse,
  StatsResult,
  SymbolMatch,
  TokenAwareContextResult,
  TokenSaverConfig,
} from "./types.js";

const CODE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts"];

const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  ".ts": "TypeScript",
  ".tsx": "TypeScript",
  ".mts": "TypeScript",
  ".cts": "TypeScript",
  ".js": "JavaScript",
  ".jsx": "JavaScript",
  ".mjs": "JavaScript",
  ".cjs": "JavaScript",
};

function normalizePath(filePath: string): string {
  return path.resolve(filePath);
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function toSafePositiveInt(value: number | undefined, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return fallback;
  }

  return Math.floor(value);
}

export class DependencyGraph {
  private readonly projectRoot: string;
  private readonly ignorePatterns: string[];
  private readonly nodes = new Map<string, GraphNode>();
  private readonly searcher = new BM25Searcher();
  private watcher?: FSWatcher;
  private lastIndexingStats: IndexingStats = {
    totalFiles: 0,
    parsedFiles: 0,
    skippedFiles: 0,
  };

  constructor(config: TokenSaverConfig) {
    this.projectRoot = normalizePath(config.projectRoot);
    this.ignorePatterns = config.ignorePatterns;
  }

  get size(): number {
    return this.nodes.size;
  }

  private isWithinProject(absPath: string): boolean {
    const relative = path.relative(this.projectRoot, absPath);
    return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
  }

  private isCodeFile(filePath: string): boolean {
    const ext = path.extname(filePath);
    return CODE_EXTENSIONS.includes(ext);
  }

  private relativeToRoot(filePath: string): string {
    return path.relative(this.projectRoot, filePath).split(path.sep).join("/");
  }

  private isIgnored(filePath: string): boolean {
    const normalized = normalizePath(filePath);
    if (!this.isWithinProject(normalized)) {
      return true;
    }

    const rel = this.relativeToRoot(normalized);
    return this.ignorePatterns.some((pattern) => {
      return minimatch(rel, pattern, { dot: true }) || minimatch(`${rel}/`, pattern, { dot: true });
    });
  }

  private resolveImport(fromFile: string, specifier: string): string | null {
    if (!(specifier.startsWith(".") || specifier.startsWith("/"))) {
      return null;
    }

    const startPath = specifier.startsWith(".")
      ? path.resolve(path.dirname(fromFile), specifier)
      : path.resolve(this.projectRoot, `.${specifier}`);

    const candidates: string[] = [startPath];

    if (!path.extname(startPath)) {
      for (const ext of CODE_EXTENSIONS) {
        candidates.push(`${startPath}${ext}`);
      }
      for (const ext of CODE_EXTENSIONS) {
        candidates.push(path.join(startPath, `index${ext}`));
      }
    }

    for (const candidate of candidates) {
      const normalized = normalizePath(candidate);
      if (!this.isWithinProject(normalized)) {
        continue;
      }
      if (fs.existsSync(normalized) && fs.statSync(normalized).isFile()) {
        return normalized;
      }
    }

    return null;
  }

  private async walkDirectory(dirPath: string): Promise<string[]> {
    const entries = await fsp.readdir(dirPath, { withFileTypes: true });
    const files: string[] = [];

    for (const entry of entries) {
      const absPath = path.join(dirPath, entry.name);
      if (this.isIgnored(absPath)) {
        continue;
      }

      if (entry.isDirectory()) {
        const nestedFiles = await this.walkDirectory(absPath);
        files.push(...nestedFiles);
        continue;
      }

      if (entry.isFile() && this.isCodeFile(absPath)) {
        files.push(normalizePath(absPath));
      }
    }

    return files;
  }

  async buildInitialGraph(): Promise<void> {
    const files = await this.walkDirectory(this.projectRoot);
    const fileSet = new Set(files);

    let parsedFiles = 0;
    let skippedFiles = 0;

    for (const file of files) {
      const result = this.updateFile(file, true);
      if (result === "parsed") {
        parsedFiles += 1;
      } else if (result === "skipped") {
        skippedFiles += 1;
      }
    }

    for (const existingFile of [...this.nodes.keys()]) {
      if (!fileSet.has(existingFile)) {
        this.removeFile(existingFile);
      }
    }

    this.lastIndexingStats = {
      totalFiles: files.length,
      parsedFiles,
      skippedFiles,
    };
  }

  updateFile(filePath: string, skipIfUnchanged = false): "parsed" | "skipped" | "ignored" | "removed" {
    const absoluteFilePath = normalizePath(filePath);

    if (this.isIgnored(absoluteFilePath) || !this.isCodeFile(absoluteFilePath)) {
      return "ignored";
    }

    if (!fs.existsSync(absoluteFilePath)) {
      this.removeFile(absoluteFilePath);
      return "removed";
    }

    let content: string;
    try {
      content = fs.readFileSync(absoluteFilePath, "utf8");
    } catch {
      return "ignored";
    }

    const hash = hashContent(content);
    const existing = this.nodes.get(absoluteFilePath);
    if (skipIfUnchanged && existing && existing.hash === hash) {
      return "skipped";
    }

    let parsed;
    try {
      parsed = parseSourceForDeps(content);
    } catch {
      return "ignored";
    }

    const resolvedDependencies = parsed.imports
      .map((specifier) => this.resolveImport(absoluteFilePath, specifier))
      .filter((dep): dep is string => dep !== null);

    this.nodes.set(absoluteFilePath, {
      filePath: absoluteFilePath,
      dependencies: new Set(resolvedDependencies),
      exports: new Set(parsed.exports),
      symbols: parsed.symbols,
      hash,
      tokenEstimate: estimateTokens(content),
      contentLength: content.length,
      updatedAt: Date.now(),
    });

    this.searcher.indexDocument(absoluteFilePath, content);
    return "parsed";
  }

  removeFile(filePath: string): void {
    const absoluteFilePath = normalizePath(filePath);
    this.nodes.delete(absoluteFilePath);
    this.searcher.removeDocument(absoluteFilePath);

    for (const node of this.nodes.values()) {
      if (node.dependencies.has(absoluteFilePath)) {
        node.dependencies.delete(absoluteFilePath);
      }
    }
  }

  async startWatcher(): Promise<void> {
    const glob = CODE_EXTENSIONS.map((ext) => `**/*${ext}`);
    this.watcher = chokidar.watch(glob, {
      cwd: this.projectRoot,
      ignoreInitial: true,
      ignored: (watchPath) => {
        const absPath = path.resolve(this.projectRoot, watchPath);
        return this.isIgnored(absPath);
      },
    });

    this.watcher
      .on("add", (file) => this.updateFile(path.resolve(this.projectRoot, file), true))
      .on("change", (file) => this.updateFile(path.resolve(this.projectRoot, file), true))
      .on("unlink", (file) => this.removeFile(path.resolve(this.projectRoot, file)));
  }

  async stopWatcher(): Promise<void> {
    if (this.watcher) {
      await this.watcher.close();
      this.watcher = undefined;
    }
  }

  private ensureInsideProject(absPath: string): void {
    if (!this.isWithinProject(absPath)) {
      throw new Error(`File is outside project root: ${absPath}`);
    }
  }

  private resolveRequestedFile(file: string): string {
    const candidate = path.resolve(this.projectRoot, file);
    this.ensureInsideProject(candidate);

    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return candidate;
    }

    if (!path.extname(candidate)) {
      for (const ext of CODE_EXTENSIONS) {
        const withExt = `${candidate}${ext}`;
        if (fs.existsSync(withExt) && fs.statSync(withExt).isFile()) {
          return withExt;
        }
      }
      for (const ext of CODE_EXTENSIONS) {
        const indexWithExt = path.join(candidate, `index${ext}`);
        if (fs.existsSync(indexWithExt) && fs.statSync(indexWithExt).isFile()) {
          return indexWithExt;
        }
      }
    }

    throw new Error(`File not found: ${file}`);
  }

  getFileContext(file: string): FileContext {
    const absoluteFile = this.resolveRequestedFile(file);

    if (!this.nodes.has(absoluteFile)) {
      this.updateFile(absoluteFile, true);
    }

    const requestedContent = fs.readFileSync(absoluteFile, "utf8");
    const node = this.nodes.get(absoluteFile);
    const dependencyFiles = [...(node?.dependencies ?? [])];

    const directDependencies = dependencyFiles
      .filter((depPath) => fs.existsSync(depPath) && fs.statSync(depPath).isFile())
      .map((depPath) => ({
        path: this.relativeToRoot(depPath),
        content: fs.readFileSync(depPath, "utf8"),
      }));

    return {
      requestedFile: {
        path: this.relativeToRoot(absoluteFile),
        content: requestedContent,
      },
      directDependencies,
    };
  }

  getContext(file: string, maxTokens = 10_000): TokenAwareContextResult {
    const safeMaxTokens = toSafePositiveInt(maxTokens, 10_000);
    const absoluteFile = this.resolveRequestedFile(file);

    if (!this.nodes.has(absoluteFile)) {
      this.updateFile(absoluteFile, true);
    }

    const queue: Array<{ filePath: string; depth: number }> = [{ filePath: absoluteFile, depth: 0 }];
    const visited = new Set<string>([absoluteFile]);

    const includedFiles: TokenAwareContextResult["includedFiles"] = [];
    const excludedFiles: TokenAwareContextResult["excludedFiles"] = [];

    let totalTokens = 0;
    let truncated = false;

    while (queue.length > 0) {
      const item = queue.shift();
      if (!item) {
        continue;
      }

      const { filePath: currentFile, depth } = item;

      if (!fs.existsSync(currentFile) || !fs.statSync(currentFile).isFile()) {
        excludedFiles.push({
          path: this.relativeToRoot(currentFile),
          reason: "File is missing.",
          tokens: 0,
          depth,
        });
        continue;
      }

      if (!this.nodes.has(currentFile)) {
        this.updateFile(currentFile, true);
      }

      const content = fs.readFileSync(currentFile, "utf8");
      const tokens = estimateTokens(content);

      if (totalTokens + tokens > safeMaxTokens) {
        truncated = true;
        excludedFiles.push({
          path: this.relativeToRoot(currentFile),
          reason: `Token budget exceeded (${totalTokens} + ${tokens} > ${safeMaxTokens}).`,
          tokens,
          depth,
        });

        for (const pending of queue) {
          excludedFiles.push({
            path: this.relativeToRoot(pending.filePath),
            reason: "Not processed because token budget was exhausted.",
            tokens: 0,
            depth: pending.depth,
          });
        }

        break;
      }

      includedFiles.push({
        path: this.relativeToRoot(currentFile),
        content,
        tokens,
        depth,
      });
      totalTokens += tokens;

      const node = this.nodes.get(currentFile);
      const dependencies = [...(node?.dependencies ?? [])].sort((a, b) => a.localeCompare(b));
      for (const dep of dependencies) {
        if (visited.has(dep)) {
          continue;
        }

        visited.add(dep);
        queue.push({ filePath: dep, depth: depth + 1 });
      }
    }

    return {
      requestedPath: this.relativeToRoot(absoluteFile),
      maxTokens: safeMaxTokens,
      totalTokens,
      includedFiles,
      excludedFiles,
      truncated,
    };
  }

  searchCodebase(query: string, maxResults = 10, maxTokens = 2_000): SearchResponse {
    const safeMaxResults = toSafePositiveInt(maxResults, 10);
    const safeMaxTokens = toSafePositiveInt(maxTokens, 2_000);
    const searchResults = this.searcher.search(query, safeMaxResults);

    const results: SearchResponse["results"] = [];
    let usedTokens = 0;
    let truncated = false;

    for (const result of searchResults) {
      const relativePath = this.relativeToRoot(result.filePath);
      const snippet = result.snippet;
      const tokens = estimateTokens(`${relativePath}\n${snippet}`);

      if (usedTokens + tokens > safeMaxTokens) {
        truncated = true;
        break;
      }

      usedTokens += tokens;
      results.push({
        path: relativePath,
        score: Number(result.score.toFixed(6)),
        snippet,
        tokens,
      });
    }

    return {
      query,
      maxResults: safeMaxResults,
      maxTokens: safeMaxTokens,
      totalMatches: searchResults.length,
      truncated,
      results,
    };
  }

  findSymbol(name: string): SymbolMatch[] {
    const needle = name.trim().toLowerCase();
    if (needle.length === 0) {
      return [];
    }

    const matches: SymbolMatch[] = [];

    const sortedNodes = [...this.nodes.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    for (const [filePath, node] of sortedNodes) {
      for (const symbol of node.symbols) {
        if (symbol.name.toLowerCase() === needle) {
          matches.push({
            name: symbol.name,
            path: this.relativeToRoot(filePath),
            line: symbol.line,
            type: symbol.type,
          });
        }
      }
    }

    return matches.sort((a, b) => {
      if (a.path === b.path) {
        return a.line - b.line;
      }
      return a.path.localeCompare(b.path);
    });
  }

  getStats(): StatsResult {
    const filesIndexed = this.nodes.size;
    const totalTokens = [...this.nodes.values()].reduce((sum, node) => sum + node.tokenEstimate, 0);

    const largestFiles = [...this.nodes.values()]
      .sort((a, b) => b.contentLength - a.contentLength)
      .slice(0, 10)
      .map((node) => ({
        path: this.relativeToRoot(node.filePath),
        tokens: node.tokenEstimate,
        bytes: Buffer.byteLength(fs.readFileSync(node.filePath, "utf8"), "utf8"),
      }));

    const languageBreakdown: Record<string, number> = {};
    for (const node of this.nodes.values()) {
      const ext = path.extname(node.filePath).toLowerCase();
      const language = LANGUAGE_BY_EXTENSION[ext] ?? "Other";
      languageBreakdown[language] = (languageBreakdown[language] ?? 0) + 1;
    }

    return {
      filesIndexed,
      totalTokens,
      largestFiles,
      languageBreakdown,
    };
  }

  getProjectTree(maxDepth = 4, maxEntries = 1000): ProjectTreeResult {
    const safeMaxDepth = Number.isFinite(maxDepth) ? Math.max(0, Math.floor(maxDepth)) : 4;
    const safeMaxEntries = Number.isFinite(maxEntries) ? Math.max(1, Math.floor(maxEntries)) : 1000;

    const lines: string[] = ["./"];
    let entriesEmitted = 0;
    let truncated = false;

    const walk = (dirPath: string, depth: number, prefix: string): void => {
      if (depth > safeMaxDepth || truncated) {
        return;
      }

      const entries = fs
        .readdirSync(dirPath, { withFileTypes: true })
        .filter((entry) => !this.isIgnored(path.join(dirPath, entry.name)))
        .sort((a, b) => {
          if (a.isDirectory() && !b.isDirectory()) {
            return -1;
          }
          if (!a.isDirectory() && b.isDirectory()) {
            return 1;
          }
          return a.name.localeCompare(b.name);
        });

      for (let i = 0; i < entries.length; i += 1) {
        const entry = entries[i];
        const isLast = i === entries.length - 1;
        const connector = isLast ? "└── " : "├── ";
        const suffix = entry.isDirectory() ? "/" : "";

        lines.push(`${prefix}${connector}${entry.name}${suffix}`);
        entriesEmitted += 1;

        if (entriesEmitted >= safeMaxEntries) {
          truncated = true;
          lines.push(`${prefix}${isLast ? "    " : "│   "}└── … (truncated at ${safeMaxEntries} entries)`);
          return;
        }

        if (entry.isDirectory() && depth < safeMaxDepth) {
          const childPrefix = `${prefix}${isLast ? "    " : "│   "}`;
          walk(path.join(dirPath, entry.name), depth + 1, childPrefix);
          if (truncated) {
            return;
          }
        }
      }
    };

    walk(this.projectRoot, 0, "");

    return {
      root: this.projectRoot,
      maxDepth: safeMaxDepth,
      maxEntries: safeMaxEntries,
      truncated,
      lines,
    };
  }

  getIndexingStats(): IndexingStats {
    return { ...this.lastIndexingStats };
  }

  toSummary(): { filesTracked: number; projectRoot: string } {
    return {
      filesTracked: this.size,
      projectRoot: this.projectRoot,
    };
  }
}
