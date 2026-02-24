import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { DependencyGraph } from "../src/dependencyGraph.js";
import { BM25Searcher } from "../src/search.js";

const projectRoot = path.resolve(process.cwd(), "test/test-project");

function createGraph(): DependencyGraph {
  return new DependencyGraph({
    projectRoot,
    ignorePatterns: ["**/node_modules/**", "**/dist/**"],
  });
}

test("BM25 search returns relevant results", async () => {
  const graph = createGraph();
  await graph.buildInitialGraph();

  const results = graph.searchCodebase("queryById users", 5, 1000);

  assert.ok(results.results.length > 0, "Expected at least one search result");
  assert.ok(
    results.results.some((result) => result.path === "src/utils/db.ts"),
    "Expected src/utils/db.ts to be among top results",
  );
  assert.ok(results.results[0]?.snippet.length > 0, "Expected snippets in search results");
});

test("BM25 search handles empty index", () => {
  const searcher = new BM25Searcher();
  const results = searcher.search("anything");
  assert.deepEqual(results, []);
});

test("token-aware context respects maxTokens", async () => {
  const graph = createGraph();
  await graph.buildInitialGraph();

  const context = graph.getContext("src/controllers/UserController.ts", 40);

  assert.ok(context.totalTokens <= 40, `Expected totalTokens <= 40, got ${context.totalTokens}`);
  assert.equal(context.requestedPath, "src/controllers/UserController.ts");
  assert.ok(context.includedFiles.length >= 1, "Expected at least the requested file to be included");
  assert.equal(context.includedFiles[0]?.path, "src/controllers/UserController.ts");
});

test("incremental indexing skips unchanged files", async () => {
  const graph = createGraph();
  await graph.buildInitialGraph();

  const firstPass = graph.getIndexingStats();
  assert.ok(firstPass.parsedFiles >= 1, "First pass should parse files");

  await graph.buildInitialGraph();
  const secondPass = graph.getIndexingStats();

  assert.equal(secondPass.parsedFiles, 0);
  assert.equal(secondPass.skippedFiles, secondPass.totalFiles);
});

test("find_symbol finds exported functions", async () => {
  const graph = createGraph();
  await graph.buildInitialGraph();

  const matches = graph.findSymbol("getUser");

  assert.equal(matches.length, 1);
  assert.equal(matches[0]?.path, "src/services/UserService.ts");
  assert.equal(matches[0]?.type, "function");
  assert.ok((matches[0]?.line ?? 0) > 0);
});

test("get_stats returns correct file count", async () => {
  const graph = createGraph();
  await graph.buildInitialGraph();

  const stats = graph.getStats();

  assert.equal(stats.filesIndexed, 4);
  assert.ok(stats.totalTokens > 0);
  assert.equal(stats.languageBreakdown.TypeScript, 4);
});

test("get_file_context still works", async () => {
  const graph = createGraph();
  await graph.buildInitialGraph();

  const context = graph.getFileContext("src/controllers/UserController.ts");

  assert.equal(context.requestedFile.path, "src/controllers/UserController.ts");
  assert.equal(context.directDependencies.length, 1);
  assert.equal(context.directDependencies[0]?.path, "src/services/UserService.ts");
});

test("get_project_tree still works", async () => {
  const graph = createGraph();
  await graph.buildInitialGraph();

  const tree = graph.getProjectTree(3, 100);

  assert.equal(tree.truncated, false);
  assert.ok(tree.lines.some((line) => line.includes("src/")), "Expected src directory in project tree");
  assert.ok(
    tree.lines.some((line) => line.includes("UserService.ts")),
    "Expected UserService.ts in project tree output",
  );
});
