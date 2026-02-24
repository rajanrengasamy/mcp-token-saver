import fs from "node:fs";
import path from "node:path";
import { TokenSaverConfig } from "./types.js";

interface CliArgs {
  project?: string;
  ignore?: string;
  config?: string;
  scanOnly?: boolean;
}

interface RawConfig {
  projectRoot?: string;
  ignorePatterns?: string[];
}

const DEFAULT_IGNORE = ["**/node_modules/**", "**/dist/**", "**/.git/**", "**/build/**"];

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {};

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    const next = argv[i + 1];

    if (token === "--project" && next) {
      args.project = next;
      i += 1;
      continue;
    }

    if (token === "--ignore" && next) {
      args.ignore = next;
      i += 1;
      continue;
    }

    if (token === "--config" && next) {
      args.config = next;
      i += 1;
      continue;
    }

    if (token === "--scan-only") {
      args.scanOnly = true;
      continue;
    }
  }

  return args;
}

function splitIgnorePatterns(value?: string): string[] {
  if (!value) {
    return [];
  }

  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function loadConfigFile(configPath: string): RawConfig {
  if (!fs.existsSync(configPath)) {
    return {};
  }

  const raw = fs.readFileSync(configPath, "utf8");
  const parsed = JSON.parse(raw) as RawConfig;
  return parsed;
}

export function resolveConfig(cwd = process.cwd()): { config: TokenSaverConfig; scanOnly: boolean } {
  const args = parseArgs(process.argv.slice(2));
  const configPath = path.resolve(cwd, args.config ?? "token-saver.config.json");
  const fileConfig = loadConfigFile(configPath);

  const projectRoot = path.resolve(
    cwd,
    args.project ?? process.env.PROJECT_ROOT ?? fileConfig.projectRoot ?? cwd,
  );

  const ignoreFromEnv = splitIgnorePatterns(process.env.IGNORE_PATTERNS);
  const ignoreFromArgs = splitIgnorePatterns(args.ignore);

  const ignorePatterns = [
    ...DEFAULT_IGNORE,
    ...(fileConfig.ignorePatterns ?? []),
    ...ignoreFromEnv,
    ...ignoreFromArgs,
  ];

  return {
    config: {
      projectRoot,
      ignorePatterns,
    },
    scanOnly: Boolean(args.scanOnly),
  };
}
