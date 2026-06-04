import { createReadStream } from "node:fs";
import readline from "node:readline";

export type InsertStatement = {
  table: string;
  columns: string[] | null;
  rows: string[];
};

export type DumpStatement =
  | { type: "create-table"; table: string; columns: string[] }
  | ({ type: "insert" } & InsertStatement);

export async function* readDumpStatements(dumpPath: string): AsyncGenerator<DumpStatement> {
  const stream = createReadStream(dumpPath, { encoding: "utf8" });
  const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });
  let currentCreateTable: { table: string; columns: string[] } | null = null;

  for await (const line of lines) {
    if (currentCreateTable) {
      const columnMatch = line.match(/^\s*[`"]([^`"]+)[`"]/);
      if (columnMatch?.[1]) {
        currentCreateTable.columns.push(columnMatch[1]);
      }

      if (line.startsWith(")") || line.startsWith(") ")) {
        yield {
          type: "create-table",
          table: currentCreateTable.table,
          columns: currentCreateTable.columns
        };
        currentCreateTable = null;
      }

      continue;
    }

    const createMatch = line.match(/^CREATE TABLE [`"]?([^`"\s(]+)[`"]?/i);
    if (createMatch?.[1]) {
      const columns = extractColumnNames(line);

      if (line.includes(")") && columns.length > 0) {
        yield { type: "create-table", table: createMatch[1], columns };
      } else {
        currentCreateTable = { table: createMatch[1], columns };
      }

      continue;
    }

    const insertMatch = line.match(/^INSERT INTO [`"]?([^`"\s(]+)[`"]?(?:\s*\(([^)]*)\))?\s+VALUES (.+);$/i);
    if (insertMatch?.[1] && insertMatch?.[3]) {
      yield {
        type: "insert",
        table: insertMatch[1],
        columns: insertMatch[2] ? extractInsertColumnNames(insertMatch[2]) : null,
        rows: splitInsertRows(insertMatch[3])
      };
    }
  }

  if (currentCreateTable) {
    yield {
      type: "create-table",
      table: currentCreateTable.table,
      columns: currentCreateTable.columns
    };
  }
}

export function splitInsertRows(values: string): string[] {
  const rows: string[] = [];
  let current = "";
  let inString = false;
  let escapeNext = false;
  let depth = 0;

  for (const char of values) {
    if (escapeNext) {
      current += char;
      escapeNext = false;
      continue;
    }

    if (char === "\\") {
      current += char;
      escapeNext = true;
      continue;
    }

    if (char === "'") {
      inString = !inString;
      current += char;
      continue;
    }

    if (!inString && char === "(") {
      depth += 1;
      if (depth === 1) {
        current = "";
        continue;
      }
    }

    if (!inString && char === ")") {
      depth -= 1;
      if (depth === 0) {
        rows.push(current);
        current = "";
        continue;
      }
    }

    if (depth > 0) {
      current += char;
    }
  }

  return rows;
}

export function splitSqlValues(row: string): string[] {
  const values: string[] = [];
  let current = "";
  let inString = false;
  let escapeNext = false;

  for (const char of row) {
    if (escapeNext) {
      current += char;
      escapeNext = false;
      continue;
    }

    if (char === "\\") {
      current += char;
      escapeNext = true;
      continue;
    }

    if (char === "'") {
      inString = !inString;
      continue;
    }

    if (!inString && char === ",") {
      values.push(unescapeSqlValue(current));
      current = "";
      continue;
    }

    current += char;
  }

  values.push(unescapeSqlValue(current));
  return values;
}

function unescapeSqlValue(value: string): string {
  const trimmed = value.trim();
  if (trimmed.toUpperCase() === "NULL") {
    return "";
  }

  return trimmed
    .replaceAll("\\'", "'")
    .replaceAll("\\\\", "\\")
    .replaceAll("\\r", "\r")
    .replaceAll("\\n", "\n");
}

function extractColumnNames(line: string) {
  const columns: string[] = [];
  const matches = line.matchAll(/[`"]([^`"]+)[`"]\s+[A-Za-z]/g);

  for (const match of matches) {
    if (match[1] && !match[1].includes(".")) {
      columns.push(match[1]);
    }
  }

  return columns;
}

function extractInsertColumnNames(columnList: string) {
  return Array.from(columnList.matchAll(/[`"]?([^`",\s)]+)[`"]?/g))
    .map((match) => match[1])
    .filter((column): column is string => Boolean(column));
}
