import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { DependencyGraph } from "../src/dependencyGraph.js";

const projectRoot = path.resolve(process.cwd(), "test/test-project");

test("builds graph and returns direct dependencies", async () => {
  const graph = new DependencyGraph({
    projectRoot,
    ignorePatterns: ["**/node_modules/**", "**/dist/**"],
  });

  await graph.buildInitialGraph();
  assert.ok(graph.size >= 4, `Expected at least 4 files, got ${graph.size}`);

  const context = graph.getFileContext("src/controllers/UserController.ts");

  assert.equal(context.requestedFile.path, "src/controllers/UserController.ts");
  assert.equal(context.directDependencies.length, 1);
  assert.equal(context.directDependencies[0]?.path, "src/services/UserService.ts");
});

test("resolves extensionless and nested imports", async () => {
  const graph = new DependencyGraph({
    projectRoot,
    ignorePatterns: ["**/node_modules/**", "**/dist/**"],
  });

  await graph.buildInitialGraph();

  const context = graph.getFileContext("src/services/UserService");
  const depPaths = context.directDependencies.map((dep) => dep.path).sort();

  assert.deepEqual(depPaths, ["src/models/User.ts", "src/utils/db.ts"]);
});
