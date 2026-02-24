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
      ],
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    if (request.params.name === "get_file_context") {
      const args = asObject(request.params.arguments);
      const file = args.file;

      if (typeof file !== "string" || file.trim().length === 0) {
        throw new Error("Argument 'file' must be a non-empty string.");
      }

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
