import path from "node:path";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { resolveConfig } from "./config.js";
import { DependencyGraph } from "./dependencyGraph.js";

function asObject(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function asOptionalPositiveInteger(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.floor(value);
  }

  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }

  return fallback;
}

function asRequiredString(value: unknown, argumentName: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Argument '${argumentName}' must be a non-empty string.`);
  }

  return value;
}

async function main(): Promise<void> {
  const { config, scanOnly } = resolveConfig(process.cwd());

  const graph = new DependencyGraph(config);
  await graph.buildInitialGraph();

  if (scanOnly) {
    const summary = graph.toSummary();
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  await graph.startWatcher();

  const server = new Server(
    {
      name: "mcp-token-saver",
      version: "0.1.0",
    },
    {
      capabilities: {
        tools: {},
      },
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [
        {
          name: "get_file_context",
          description:
            "Return a requested file and its direct internal dependencies (imports/exports) for token-efficient code context.",
          inputSchema: {
            type: "object",
            properties: {
              file: {
                type: "string",
                description: "Path to a file relative to project root (e.g. src/services/userService.ts)",
              },
            },
            required: ["file"],
          },
        },
        {
          name: "get_context",
          description:
            "Return token-budget-aware transitive context using breadth-first dependency traversal.",
          inputSchema: {
            type: "object",
            properties: {
              file: {
                type: "string",
                description: "Path to a file relative to project root.",
              },
              maxTokens: {
                type: "number",
                description: "Maximum token budget to include (default: 10000).",
              },
            },
            required: ["file"],
          },
        },
        {
          name: "search_codebase",
          description: "Search indexed code using BM25 ranking and return top matching snippets.",
          inputSchema: {
            type: "object",
            properties: {
              query: {
                type: "string",
                description: "Search query text.",
              },
              maxResults: {
                type: "number",
                description: "Maximum results to return (default: 10).",
              },
              maxTokens: {
                type: "number",
                description: "Maximum token budget for returned snippets (default: 2000).",
              },
            },
            required: ["query"],
          },
        },
        {
          name: "find_symbol",
          description: "Find exported function/class/interface/const symbols by exact name.",
          inputSchema: {
            type: "object",
            properties: {
              name: {
                type: "string",
                description: "Exported symbol name to look up.",
              },
            },
            required: ["name"],
          },
        },
        {
          name: "get_project_tree",
          description:
            "Return a compact directory tree for the project (file and folder names only, no file content).",
          inputSchema: {
            type: "object",
            properties: {
              maxDepth: {
                type: "number",
                description: "Optional max directory depth to include (default: 4).",
              },
              maxEntries: {
                type: "number",
                description: "Optional safety cap for total emitted entries (default: 1000).",
              },
            },
          },
        },
        {
          name: "get_stats",
          description: "Return index statistics: files indexed, total tokens, largest files, language breakdown.",
          inputSchema: {
            type: "object",
            properties: {},
          },
        },
      ],
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    if (request.params.name === "get_file_context") {
      const args = asObject(request.params.arguments);
      const file = asRequiredString(args.file, "file");
      const context = graph.getFileContext(file);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(context, null, 2),
          },
        ],
      };
    }

    if (request.params.name === "get_context") {
      const args = asObject(request.params.arguments);
      const file = asRequiredString(args.file, "file");
      const maxTokens = asOptionalPositiveInteger(args.maxTokens, 10_000);
      const context = graph.getContext(file, maxTokens);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(context, null, 2),
          },
        ],
      };
    }

    if (request.params.name === "search_codebase") {
      const args = asObject(request.params.arguments);
      const query = asRequiredString(args.query, "query");
      const maxResults = asOptionalPositiveInteger(args.maxResults, 10);
      const maxTokens = asOptionalPositiveInteger(args.maxTokens, 2_000);
      const results = graph.searchCodebase(query, maxResults, maxTokens);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(results, null, 2),
          },
        ],
      };
    }

    if (request.params.name === "find_symbol") {
      const args = asObject(request.params.arguments);
      const name = asRequiredString(args.name, "name");
      const matches = graph.findSymbol(name);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ name, matches }, null, 2),
          },
        ],
      };
    }

    if (request.params.name === "get_project_tree") {
      const args = asObject(request.params.arguments);
      const maxDepth = asOptionalPositiveInteger(args.maxDepth, 4);
      const maxEntries = asOptionalPositiveInteger(args.maxEntries, 1000);
      const tree = graph.getProjectTree(maxDepth, maxEntries);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(tree, null, 2),
          },
        ],
      };
    }

    if (request.params.name === "get_stats") {
      const stats = graph.getStats();
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(stats, null, 2),
          },
        ],
      };
    }

    throw new Error(`Unknown tool: ${request.params.name}`);
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);

  const shutdown = async (): Promise<void> => {
    await graph.stopWatcher();
    await server.close();
    process.exit(0);
  };

  process.on("SIGINT", () => {
    void shutdown();
  });
  process.on("SIGTERM", () => {
    void shutdown();
  });

  const relativeRoot = path.relative(process.cwd(), config.projectRoot) || ".";
  console.error(`[mcp-token-saver] ready. projectRoot=${relativeRoot}, files=${graph.size}`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(`[mcp-token-saver] fatal: ${message}`);
  process.exit(1);
});
