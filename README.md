# mcp-token-saver

Open-source MCP context engine for code assistants. It builds an incremental dependency graph, supports BM25 search, returns token-budget-aware context, and keeps everything local-first.

![npm version](https://img.shields.io/npm/v/mcp-token-saver?label=npm)
![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)
![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)

## Why

Most assistants over-fetch context and waste tokens. `mcp-token-saver` returns only what matters:

- requested file + direct deps (`get_file_context`)
- token-aware transitive deps (`get_context`)
- ranked BM25 search snippets (`search_codebase`)
- exported symbol lookup (`find_symbol`)
- project/index diagnostics (`get_project_tree`, `get_stats`)

## Tools

| Tool | Description | Parameters |
|------|-------------|------------|
| get_file_context | Get file + direct deps | file: string |
| get_context | Token-budget-aware transitive context | file: string, maxTokens?: number |
| search_codebase | BM25 keyword search across all files | query: string, maxResults?: number |
| find_symbol | Find function/class/interface by name | name: string |
| get_project_tree | Compact file tree | maxDepth?: number |
| get_stats | Project index statistics | — |

> `search_codebase` also supports `maxTokens?: number` to cap returned snippet tokens.

## vs Augment Code

| Feature | mcp-token-saver (free) | Augment Code ($20-200/mo) |
|---------|------------------------|--------------------------|
| Dependency graph | ✅ | ✅ |
| Keyword/BM25 search | ✅ | — |
| Semantic search | Coming soon (Ollama) | ✅ |
| Token-aware context | ✅ | ✅ |
| Symbol finder | ✅ | ✅ |
| Local-first / private | ✅ | Partial |
| Cost | Free / MIT | $20-200/mo |

## Install

```bash
npm install
npm run build
```

## Usage (Claude Desktop / Cursor)

Point your MCP server command to:

```bash
node /absolute/path/to/mcp-token-saver/dist/src/index.js --project /absolute/path/to/your/project
```

## Config

Create `token-saver.config.json`:

```json
{
  "projectRoot": "/absolute/path/to/project",
  "ignorePatterns": ["**/node_modules/**", "**/dist/**", "**/.git/**"]
}
```

## Development

```bash
npm run build
npm test
```

## License

MIT
