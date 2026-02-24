import { SearchResult } from "./types.js";

interface IndexedDocument {
  id: string;
  content: string;
  termFreq: Map<string, number>;
  length: number;
}

const DEFAULT_STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "for",
  "from",
  "has",
  "he",
  "in",
  "is",
  "it",
  "its",
  "of",
  "on",
  "or",
  "that",
  "the",
  "to",
  "was",
  "were",
  "will",
  "with",
  "this",
  "return",
  "const",
  "let",
  "var",
  "function",
  "class",
  "interface",
  "export",
  "import",
  "default",
  "type",
  "public",
  "private",
  "protected",
  "void",
  "string",
  "number",
  "boolean",
  "true",
  "false",
]);

export class BM25Searcher {
  private readonly k1: number;
  private readonly b: number;
  private readonly stopWords: Set<string>;

  private readonly documents = new Map<string, IndexedDocument>();
  private readonly documentFrequency = new Map<string, number>();
  private totalDocumentLength = 0;

  constructor(options?: { k1?: number; b?: number; stopWords?: Set<string> }) {
    this.k1 = options?.k1 ?? 1.2;
    this.b = options?.b ?? 0.75;
    this.stopWords = options?.stopWords ?? DEFAULT_STOP_WORDS;
  }

  get size(): number {
    return this.documents.size;
  }

  tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .map((token) => token.trim())
      .filter((token) => token.length > 1 && !this.stopWords.has(token));
  }

  indexDocument(id: string, content: string): void {
    this.removeDocument(id);

    const tokens = this.tokenize(content);
    const termFreq = new Map<string, number>();

    for (const token of tokens) {
      termFreq.set(token, (termFreq.get(token) ?? 0) + 1);
    }

    for (const token of termFreq.keys()) {
      this.documentFrequency.set(token, (this.documentFrequency.get(token) ?? 0) + 1);
    }

    const document: IndexedDocument = {
      id,
      content,
      termFreq,
      length: tokens.length,
    };

    this.documents.set(id, document);
    this.totalDocumentLength += document.length;
  }

  removeDocument(id: string): void {
    const existing = this.documents.get(id);
    if (!existing) {
      return;
    }

    for (const token of existing.termFreq.keys()) {
      const current = this.documentFrequency.get(token);
      if (!current) {
        continue;
      }

      if (current <= 1) {
        this.documentFrequency.delete(token);
      } else {
        this.documentFrequency.set(token, current - 1);
      }
    }

    this.totalDocumentLength = Math.max(0, this.totalDocumentLength - existing.length);
    this.documents.delete(id);
  }

  search(query: string, maxResults = 10): SearchResult[] {
    if (this.documents.size === 0) {
      return [];
    }

    const queryTokens = this.tokenize(query);
    if (queryTokens.length === 0) {
      return [];
    }

    const averageDocLength = this.totalDocumentLength / this.documents.size || 1;
    const scored: SearchResult[] = [];

    for (const document of this.documents.values()) {
      let score = 0;

      for (const token of queryTokens) {
        const tf = document.termFreq.get(token) ?? 0;
        if (tf === 0) {
          continue;
        }

        const df = this.documentFrequency.get(token) ?? 0;
        const idf = Math.log(1 + (this.documents.size - df + 0.5) / (df + 0.5));

        const numerator = tf * (this.k1 + 1);
        const denominator = tf + this.k1 * (1 - this.b + this.b * (document.length / averageDocLength));
        score += idf * (numerator / denominator);
      }

      if (score > 0) {
        scored.push({
          filePath: document.id,
          score,
          snippet: this.createSnippet(document.content, queryTokens),
        });
      }
    }

    return scored.sort((a, b) => b.score - a.score).slice(0, Math.max(1, Math.floor(maxResults)));
  }

  private createSnippet(content: string, queryTokens: string[]): string {
    if (content.length === 0) {
      return "";
    }

    const normalized = content.toLowerCase();
    let firstMatch = -1;
    for (const token of queryTokens) {
      const idx = normalized.indexOf(token);
      if (idx !== -1 && (firstMatch === -1 || idx < firstMatch)) {
        firstMatch = idx;
      }
    }

    if (firstMatch === -1) {
      const fallback = content.slice(0, 220);
      return fallback.replace(/\s+/g, " ").trim();
    }

    const start = Math.max(0, firstMatch - 80);
    const end = Math.min(content.length, firstMatch + 140);
    const prefix = start > 0 ? "…" : "";
    const suffix = end < content.length ? "…" : "";
    return `${prefix}${content.slice(start, end).replace(/\s+/g, " ").trim()}${suffix}`;
  }
}
