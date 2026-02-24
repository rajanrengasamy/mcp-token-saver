# PRD: MCP Token Saver

## Problem

AI coding assistants like Claude Code repeatedly re-read hundreds of files every session to understand the project structure. This consumes massive amounts of tokens and slows down responses. The original poster cut token usage by 65% by building a local dependency graph using AST parsing and serving only relevant context via MCP (Model Context Protocol).

**Evidence:** 155 upvotes, 34 comments on r/ClaudeAI. Strong developer engagement and validation.

## Target Users

1. **Primary:** Developers using Claude Code, Cursor, or other AI coding assistants
2. **Secondary:** Teams with large TypeScript/JavaScript codebases
3. **Tertiary:** Anyone building MCP servers for LLM context management

## Solution

A background daemon (MCP Server) that:
1. Watches a TypeScript/JavaScript project directory
2. Builds a dependency graph using AST parsing (imports, exports, function calls)
3. When the LLM requests a file, serves only that file + its direct dependencies
4. Caches the graph and updates incrementally on file changes
5. Reduces token usage by avoiding full codebase scans

**Key differentiator:** First open-source MCP implementation focused on intelligent context reduction. Directly applicable to our own workflows.

## Architecture

**Stack:**
- TypeScript/Node.js (MCP server standard)
- @typescript-eslint/typescript-estree for AST parsing
- chokidar for file watching
- MCP SDK (@modelcontextprotocol/sdk)
- SQLite for graph storage (optional, can start in-memory)

**Components:**

1. **File Watcher:** Monitors project directory for changes
2. **AST Parser:** Extracts imports, exports, and function references
3. **Dependency Graph:** Builds and maintains relationships
4. **MCP Server:** Exposes `get_file_context` tool to LLM
5. **Cache Manager:** Invalidates stale graph nodes on file changes

**Flow:**
1. User configures MCP server in Claude Desktop config
2. Server scans project on startup, builds initial graph
3. LLM asks for file context via MCP tool
4. Server returns file + direct imports/exports (not entire codebase)
5. On file save, server updates graph incrementally

## MVP Scope (Night-Buildable)

**Must Have:**
- ✅ Basic MCP server setup (stdio transport)
- ✅ AST parsing for TypeScript files (imports/exports only)
- ✅ In-memory dependency graph
- ✅ `get_file_context` tool that returns file + direct imports
- ✅ File watcher for incremental updates
- ✅ Configuration file (specify project root, ignore patterns)
- ✅ Claude Desktop integration (config example)

**Nice to Have (Stub/Skip for MVP):**
- 🔲 Function-level dependency tracking (currently file-level only)
- 🔲 SQLite persistence (start with in-memory)
- 🔲 Multi-language support (Python, Go, etc.) - start with TS/JS only
- 🔲 Graph visualization UI
- 🔲 Token usage analytics/reporting
- 🔲 Smart context expansion (2-hop dependencies for complex queries)

**Known Constraints:**
- TypeScript/JavaScript only for MVP
- File-level dependencies, not function-level
- No cross-project dependency resolution
- MCP protocol is new and evolving (may need updates)

## Run/Demo Commands

```bash
# Install
cd mcp-token-saver
npm install
npm run build

# Configure Claude Desktop
# Edit ~/Library/Application\ Support/Claude/claude_desktop_config.json
# Add:
{
  "mcpServers": {
    "token-saver": {
      "command": "node",
      "args": ["/path/to/mcp-token-saver/dist/index.js"],
      "env": {
        "PROJECT_ROOT": "/path/to/your/project"
      }
    }
  }
}

# Test standalone
node dist/index.js --project ./test-project

# Verify graph
npm run test
```

**Demo flow:**
1. Install and configure MCP server in Claude Desktop
2. Open a TypeScript project with 50+ files
3. Ask Claude: "What does UserService.ts do?"
4. Observe MCP call: returns UserService.ts + its direct imports (3-5 files)
5. Compare token usage vs. full codebase scan (should be ~70% reduction)
6. Edit a file, verify graph updates automatically

**Test project needed:**
- Small TypeScript project with clear dependency chains
- Example: Express API with models, services, controllers structure

## Success Metrics

- Successfully builds dependency graph for test project (50+ files) in <5 seconds
- MCP tool returns file + dependencies in <500ms
- Token reduction: >50% vs. full codebase context
- File watcher detects changes and updates graph within 1 second
- Works with Claude Desktop out of the box (config only)

## Technical Risks

1. **AST parsing complexity:** Dynamic imports, barrel files, circular dependencies
   - *Mitigation:* Start with simple static imports, expand iteratively
2. **MCP protocol changes:** Still evolving, may break
   - *Mitigation:* Pin MCP SDK version, monitor updates
3. **Performance with large codebases:** 1000+ files may be slow
   - *Mitigation:* Implement incremental parsing, ignore node_modules
4. **LLM prompt compatibility:** Claude may need prompting to use MCP tool
   - *Mitigation:* Provide example prompts in README

## Integration Strategy

**Claude Desktop Config:**
```json
{
  "mcpServers": {
    "token-saver": {
      "command": "node",
      "args": ["/absolute/path/to/mcp-token-saver/dist/index.js"],
      "env": {
        "PROJECT_ROOT": "/absolute/path/to/your/project",
        "IGNORE_PATTERNS": "node_modules,dist,build"
      }
    }
  }
}
```

**Usage in Claude:**
- User: "Analyze the authentication flow in this project"
- Claude calls `get_file_context("auth.ts")`
- MCP returns auth.ts + JWT.ts + UserModel.ts (only dependencies)
- Claude reasons over 3 files instead of 200

## Launch Checklist

- [ ] Working TypeScript implementation
- [ ] Example Claude Desktop config
- [ ] Test project with known dependencies
- [ ] README with setup instructions
- [ ] Blog post explaining token savings
- [ ] Submit to r/ClaudeAI as response to original post
- [ ] Consider contributing to Anthropic's MCP examples repo

---

**Expected completion:** 10-12 hours (working MVP)  
**Likely working:** AST parsing, dependency graph, MCP server, file watcher, basic context retrieval  
**Likely stubbed:** Function-level deps, persistence, multi-language support, graph visualization
