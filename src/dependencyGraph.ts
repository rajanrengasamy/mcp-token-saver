import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import chokidar, { FSWatcher } from "chokidar";
import { minimatch } from "minimatch";
import { parseFileForDeps } from "./parser.js";
import { FileContext, GraphNode, ProjectTreeResult, TokenSaverConfig } from "./types.js";

const CODE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts"];

function normalizePath(filePath: string): string {
  return path.resolve(filePath);
}

export class DependencyGraph {
  private readonly projectRoot: string;
  private readonly ignorePatterns: string[];
  private readonly nodes = new Map<string, GraphNode>();
  private watcher?: FSWatcher;

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
    for (const file of files) {
      this.updateFile(file);
    }
  }

  updateFile(filePath: string): void {
    const absoluteFilePath = normalizePath(filePath);

    if (this.isIgnored(absoluteFilePath) || !this.isCodeFile(absoluteFilePath)) {
      return;
    }

    if (!fs.existsSync(absoluteFilePath)) {
      this.removeFile(absoluteFilePath);
      return;
    }

    let parsed;
    try {
      parsed = parseFileForDeps(absoluteFilePath);
    } catch {
      return;
    }

    const resolvedDependencies = parsed.imports
      .map((specifier) => this.resolveImport(absoluteFilePath, specifier))
      .filter((dep): dep is string => dep !== null);

    this.nodes.set(absoluteFilePath, {
      filePath: absoluteFilePath,
      dependencies: new Set(resolvedDependencies),
      exports: new Set(parsed.exports),
      updatedAt: Date.now(),
    });
  }

  removeFile(filePath: string): void {
    const absoluteFilePath = normalizePath(filePath);
    this.nodes.delete(absoluteFilePath);

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
      .on("add", (file) => this.updateFile(path.resolve(this.projectRoot, file)))
      .on("change", (file) => this.updateFile(path.resolve(this.projectRoot, file)))
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
      this.updateFile(absoluteFile);
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

  toSummary(): { filesTracked: number; projectRoot: string } {
    return {
      filesTracked: this.size,
      projectRoot: this.projectRoot,
    };
  }
}
