import fs from "node:fs";
import { parse } from "@typescript-eslint/typescript-estree";
import { ExportedSymbol, ParsedFileInfo, SymbolType } from "./types.js";

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function walkAst(node: unknown, visitor: (node: Record<string, unknown>) => void): void {
  if (!isObject(node)) {
    return;
  }

  visitor(node);

  for (const value of Object.values(node)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        walkAst(item, visitor);
      }
      continue;
    }

    walkAst(value, visitor);
  }
}

function pushUnique(values: string[], value: string): void {
  if (!values.includes(value)) {
    values.push(value);
  }
}

function symbolKey(symbol: ExportedSymbol): string {
  return `${symbol.name}:${symbol.type}:${symbol.line}`;
}

function pushUniqueSymbol(symbols: ExportedSymbol[], symbol: ExportedSymbol): void {
  const key = symbolKey(symbol);
  if (!symbols.some((existing) => symbolKey(existing) === key)) {
    symbols.push(symbol);
  }
}

function getLine(node: Record<string, unknown>): number {
  const loc = node.loc;
  if (!isObject(loc)) {
    return 1;
  }
  const start = loc.start;
  if (!isObject(start) || typeof start.line !== "number") {
    return 1;
  }

  return start.line;
}

function getIdentifierName(node: unknown): string | null {
  if (!isObject(node)) {
    return null;
  }
  if (node.type !== "Identifier") {
    return null;
  }
  return typeof node.name === "string" ? node.name : null;
}

function declarationSymbolType(nodeType: unknown, declarationKind?: unknown): SymbolType | null {
  if (nodeType === "FunctionDeclaration") {
    return "function";
  }
  if (nodeType === "ClassDeclaration") {
    return "class";
  }
  if (nodeType === "TSInterfaceDeclaration") {
    return "interface";
  }
  if (nodeType === "VariableDeclaration" && declarationKind === "const") {
    return "const";
  }
  return null;
}

export function parseSourceForDeps(code: string): ParsedFileInfo {
  const ast = parse(code, {
    loc: true,
    range: false,
    comment: false,
    jsx: true,
    sourceType: "module",
    errorOnUnknownASTType: false,
  });

  const imports: string[] = [];
  const exports: string[] = [];
  const symbols: ExportedSymbol[] = [];
  const declarations = new Map<string, { type: SymbolType; line: number }>();

  walkAst(ast as unknown, (node) => {
    const nodeType = node.type;

    if (nodeType === "ImportDeclaration") {
      const source = node.source;
      if (isObject(source) && typeof source.value === "string") {
        pushUnique(imports, source.value);
      }
    }

    if (nodeType === "ExportNamedDeclaration" || nodeType === "ExportAllDeclaration") {
      const source = node.source;
      if (isObject(source) && typeof source.value === "string") {
        pushUnique(imports, source.value);
      }
    }

    if (
      nodeType === "FunctionDeclaration" ||
      nodeType === "ClassDeclaration" ||
      nodeType === "TSInterfaceDeclaration"
    ) {
      const name = getIdentifierName(node.id);
      const symbolType = declarationSymbolType(nodeType);
      if (name && symbolType) {
        declarations.set(name, {
          type: symbolType,
          line: getLine(node),
        });
      }
    }

    if (nodeType === "VariableDeclaration" && node.kind === "const" && Array.isArray(node.declarations)) {
      for (const declaration of node.declarations) {
        if (!isObject(declaration)) {
          continue;
        }

        const name = getIdentifierName(declaration.id);
        if (!name) {
          continue;
        }

        declarations.set(name, {
          type: "const",
          line: getLine(declaration),
        });
      }
    }

    if (nodeType === "ExportNamedDeclaration") {
      const declaration = node.declaration;
      if (isObject(declaration)) {
        const declarationType = declaration.type;
        const symbolType = declarationSymbolType(declarationType, declaration.kind);

        if (
          (declarationType === "FunctionDeclaration" ||
            declarationType === "ClassDeclaration" ||
            declarationType === "TSInterfaceDeclaration") &&
          symbolType
        ) {
          const name = getIdentifierName(declaration.id);
          if (name) {
            pushUnique(exports, name);
            pushUniqueSymbol(symbols, {
              name,
              type: symbolType,
              line: getLine(declaration),
            });
          }
        }

        if (declarationType === "VariableDeclaration" && declaration.kind === "const") {
          const declarationsList = declaration.declarations;
          if (Array.isArray(declarationsList)) {
            for (const declaredVar of declarationsList) {
              if (!isObject(declaredVar)) {
                continue;
              }
              const name = getIdentifierName(declaredVar.id);
              if (!name) {
                continue;
              }
              pushUnique(exports, name);
              pushUniqueSymbol(symbols, {
                name,
                type: "const",
                line: getLine(declaredVar),
              });
            }
          }
        }
      }

      const specifiers = node.specifiers;
      if (Array.isArray(specifiers)) {
        for (const spec of specifiers) {
          if (!isObject(spec)) {
            continue;
          }

          const exported = getIdentifierName(spec.exported);
          if (!exported) {
            continue;
          }

          pushUnique(exports, exported);

          const local = getIdentifierName(spec.local) ?? exported;
          const declaration = declarations.get(local);
          if (declaration) {
            pushUniqueSymbol(symbols, {
              name: exported,
              type: declaration.type,
              line: declaration.line,
            });
          }
        }
      }
    }

    if (nodeType === "ExportDefaultDeclaration") {
      pushUnique(exports, "default");
      const declaration = node.declaration;
      if (isObject(declaration)) {
        const declarationType = declaration.type;
        const symbolType = declarationSymbolType(declarationType, declaration.kind);
        const name = getIdentifierName(declaration.id);
        if (name && symbolType) {
          pushUniqueSymbol(symbols, {
            name,
            type: symbolType,
            line: getLine(declaration),
          });
        }
      }
    }

    if (nodeType === "CallExpression") {
      const callee = node.callee;
      const args = node.arguments;
      if (
        isObject(callee) &&
        callee.type === "Identifier" &&
        callee.name === "require" &&
        Array.isArray(args) &&
        args.length > 0
      ) {
        const firstArg = args[0];
        if (isObject(firstArg) && typeof firstArg.value === "string") {
          pushUnique(imports, firstArg.value);
        }
      }
    }

    if (nodeType === "ImportExpression") {
      const source = node.source;
      if (isObject(source) && typeof source.value === "string") {
        pushUnique(imports, source.value);
      }
    }
  });

  return { imports, exports, symbols };
}

export function parseFileForDeps(filePath: string): ParsedFileInfo {
  const code = fs.readFileSync(filePath, "utf8");
  return parseSourceForDeps(code);
}
