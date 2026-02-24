# MCP Token Saver

**One-line pitch:** Cut Claude Code's token usage by 65% using a local dependency graph that serves only relevant files via MCP — saves money, speeds up responses.

**Score:** 8.2 | **Type:** Framework | **Theme:** Reddit Problems

---

## Problem → Solution

**Problem:** AI coding assistants repeatedly re-read hundreds of files every session, burning tokens and slowing down responses. Claude Code, Cursor, and similar tools lack project-aware context management.

**Solution:** A background MCP server that builds a dependency graph of your TypeScript project using AST parsing. When the LLM requests a file, it serves only that file + direct dependencies instead of the entire codebase. Reduces token usage by 50-70% while maintaining accuracy.

---

## Planned Demo

```bash
cd mcp-token-saver
npm install && npm run build

# Configure Claude Desktop (add to claude_desktop_config.json):
{
  "mcpServers": {
    "token-saver": {
      "command": "node",
      "args": ["/path/to/mcp-token-saver/dist/index.js"],
      "env": { "PROJECT_ROOT": "/path/to/your/project" }
    }
  }
}

# Test standalone
node dist/index.js --project ./test-project
```

**Expected flow:**
1. Server scans TypeScript project and builds dependency graph
2. Claude asks: "What does UserService.ts do?"
3. MCP returns UserService.ts + its direct imports (3-5 files)
4. Compare token usage: 70% reduction vs. full codebase scan

---

## Stack & Timeline

**Stack:**
- TypeScript/Node.js
- @typescript-eslint/typescript-estree (AST parsing)
- chokidar (file watching)
- MCP SDK (@modelcontextprotocol/sdk)
- SQLite (optional persistence, start in-memory)

**Estimated completion:** 10-12 hours

---

## What's Working vs. Stubbed

**✅ Likely working:**
- Basic MCP server setup (stdio transport)
- AST parsing for TS/JS files (imports/exports)
- In-memory dependency graph
- `get_file_context` tool (file + direct imports)
- File watcher for incremental updates
- Configuration file (project root, ignore patterns)
- Claude Desktop integration example

**🔲 Likely stubbed:**
- Function-level dependency tracking (start file-level)
- SQLite persistence (in-memory for MVP)
- Multi-language support (Python, Go) — TS/JS only
- Graph visualization UI
- Token usage analytics/reporting
- Smart context expansion (2-hop dependencies)

---

## Morning Action

**Recommendation:** ✅ **KEEP BUILDING → SHIP**

**Why:** Strong validation (155 upvotes), directly applicable to our own workflows (we use Claude Code daily), fills a real gap in MCP ecosystem. This could become a standard tool for AI-assisted development.

**Strategic value:**
- **Dogfooding opportunity:** Use this in our own projects immediately
- **MCP ecosystem contribution:** First open-source dependency-aware MCP server
- **Developer credibility:** Shows deep understanding of Claude Code + MCP
- **Potential collaboration:** Could be featured in Anthropic's MCP examples

**Next steps:**
- Build MVP and test with our own TypeScript projects
- Measure actual token savings (before/after metrics)
- Write detailed blog post with benchmarks
- Submit to r/ClaudeAI as follow-up to original 155-upvote post
- Consider PR to Anthropic's MCP examples repo
- Package as npm module for easy installation

---

**Build status:** 🟡 QUEUED (not built in orchestrator)
