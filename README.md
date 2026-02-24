# mcp-token-saver

MCP server that returns only the requested file plus direct imports, so AI assistants stop loading your whole repo.

![npm version](https://img.shields.io/npm/v/mcp-token-saver?label=npm)
![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)
![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)

## The Problem

AI coding assistants (Claude, Cursor, Copilot) often pull far more context than necessary. That burns tokens quickly and hits model limits sooner.

In most code tasks, you only need one target file and its direct dependencies—not every file in the repository.

## How It Works

`mcp-token-saver` builds an AST-based dependency graph for your project and keeps it fresh with a file watcher. When a tool request arrives, it returns the requested file plus only directly imported internal files.

```text
Claude asks for → src/services/UserService.ts
MCP Token Saver returns →
  ├── src/services/UserService.ts        (requested)
  ├── src/models/User.ts                 (direct import)
  └── src/utils/validator.ts             (direct import)
  ✗ everything else                      (not included)
```

## Tools

| Tool | Description | Parameters |
|---|---|---|
| `get_file_context` | Returns one requested file and its direct internal dependencies (with file contents). | `file` (string, required): path relative to `projectRoot` |
| `get_project_tree` | Returns a compact project file tree (names/structure only, no file content). | `maxDepth` (number, optional, default `4`), `maxEntries` (number, optional, default `1000`) |

## Install

```bash
npm install
npm run build
```

## Usage - Claude Desktop

Add this server block to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "token-saver": {
      "command": "node",
      "args": [
        "/absolute/path/to/mcp-token-saver/dist/src/index.js",
        "--project",
        "/absolute/path/to/your/project"
      ]
    }
  }
}
```

## Usage - Cursor

Create `.cursor/mcp.json` in your project (or merge into your existing MCP config):

```json
{
  "mcpServers": {
    "token-saver": {
      "command": "node",
      "args": [
        "/absolute/path/to/mcp-token-saver/dist/src/index.js",
        "--project",
        "/absolute/path/to/your/project"
      ]
    }
  }
}
```

## Config

Create `token-saver.config.json` (see `token-saver.config.example.json`):

| Field | Type | Required | Description |
|---|---|---|---|
| `projectRoot` | string | Yes | Root directory to scan for code files. |
| `ignorePatterns` | string[] | No | Glob patterns to exclude generated/vendor files from indexing and tree output. |

## CLI / Scan mode

Inspect how many files are indexed without starting MCP stdio mode:

```bash
node dist/src/index.js --scan-only
```

For custom roots:

```bash
node dist/src/index.js --project /path/to/project --scan-only
```

## Token savings

In practice this reduces per-request context by **60-90% on medium-sized projects**, because only directly relevant files are returned.

## Built with

- MCP SDK
- `@typescript-eslint/typescript-estree` AST parser
- chokidar
- minimatch

## License

MIT
