import fs from "node:fs";
import { parse } from "@typescript-eslint/typescript-estree";
import { ParsedFileInfo } from "./types.js";

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

export function parseFileForDeps(filePath: string): ParsedFileInfo {
  const code = fs.readFileSync(filePath, "utf8");

  const ast = parse(code, {
    loc: false,
    range: false,
    comment: false,
    jsx: true,
    sourceType: "module",
    errorOnUnknownASTType: false,
  });

  const imports: string[] = [];
  const exports: string[] = [];

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

    if (nodeType === "ExportNamedDeclaration") {
      const declaration = node.declaration;
      if (isObject(declaration) && Array.isArray(declaration.declarations)) {
        for (const d of declaration.declarations) {
          if (isObject(d) && isObject(d.id) && typeof d.id.name === "string") {
            pushUnique(exports, d.id.name);
          }
        }
      }

      const specifiers = node.specifiers;
      if (Array.isArray(specifiers)) {
        for (const spec of specifiers) {
          if (isObject(spec) && isObject(spec.exported) && typeof spec.exported.name === "string") {
            pushUnique(exports, spec.exported.name);
          }
        }
      }
    }

    if (nodeType === "ExportDefaultDeclaration") {
      pushUnique(exports, "default");
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

  return { imports, exports };
}
