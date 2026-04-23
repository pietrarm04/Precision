import { ColumnType, RowMap } from "@/lib/types";

export function toStringValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "string") {
    return value.trim();
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  return String(value).trim();
}

export function normalizeHeader(value: string, index = 0): string {
  const raw = toStringValue(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9_\- ]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  if (!raw) {
    return `coluna_${index + 1}`;
  }
  return raw;
}

export function safeNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  const input = toStringValue(value);
  if (!input) {
    return null;
  }
  const normalized = input
    .replace(/[R$\s]/gi, "")
    .replace(/%$/g, "")
    .replace(/\.(?=\d{3}(\D|$))/g, "")
    .replace(",", ".");
  const num = Number(normalized);
  return Number.isFinite(num) ? num : null;
}

export function isMissing(value: unknown): boolean {
  const content = toStringValue(value).toLowerCase();
  return content === "" || content === "null" || content === "undefined" || content === "nan" || content === "-";
}

function parseDateValue(value: unknown): Date | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value;
  }
  const str = toStringValue(value);
  if (!str) {
    return null;
  }
  const nativeDate = new Date(str);
  if (!Number.isNaN(nativeDate.getTime())) {
    return nativeDate;
  }
  const br = str.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (br) {
    const day = Number(br[1]);
    const month = Number(br[2]) - 1;
    const year = Number(br[3].length === 2 ? `20${br[3]}` : br[3]);
    const date = new Date(year, month, day);
    if (!Number.isNaN(date.getTime())) {
      return date;
    }
  }
  return null;
}



export function toDate(value: unknown): string | null {
  const parsed = parseDateValue(value);
  if (!parsed) {
    return null;
  }
  return parsed.toISOString();
}

export function inferDataType(values: unknown[]): ColumnType {
  const nonEmpty = values.filter((value) => !isMissing(value));
  if (nonEmpty.length === 0) {
    return "empty";
  }
  let numbers = 0;
  let dates = 0;
  let bools = 0;
  for (const value of nonEmpty) {
    const text = toStringValue(value).toLowerCase();
    if (safeNumber(value) !== null) {
      numbers += 1;
      continue;
    }
    if (parseDateValue(value)) {
      dates += 1;
      continue;
    }
    if (["sim", "nao", "não", "yes", "no", "true", "false", "0", "1"].includes(text)) {
      bools += 1;
    }
  }
  if (numbers / nonEmpty.length > 0.7) {
    return "number";
  }
  if (dates / nonEmpty.length > 0.7) {
    return "date";
  }
  if (bools / nonEmpty.length > 0.7) {
    return "boolean";
  }
  const unique = new Set(nonEmpty.map((value) => toStringValue(value).toLowerCase()));
  if (unique.size / nonEmpty.length < 0.35) {
    return "string";
  }
  return "mixed";
}

export function countBy(items: string[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const item of items) {
    map.set(item, (map.get(item) ?? 0) + 1);
  }
  return map;
}

export function topN(source: Map<string, number>, limit: number): Array<[string, number]> {
  return [...source.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit);
}

export function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((acc, value) => acc + value, 0) / values.length;
}

export function median(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[middle - 1] + sorted[middle]) / 2;
  }
  return sorted[middle];
}

export function bucketByMonth(rows: RowMap[], dateColumn: string): Array<[string, number]> {
  const grouped = new Map<string, number>();
  for (const row of rows) {
    const parsed = parseDateValue(row[dateColumn]);
    if (!parsed) {
      continue;
    }
    const key = `${parsed.getUTCFullYear()}-${String(parsed.getUTCMonth() + 1).padStart(2, "0")}`;
    grouped.set(key, (grouped.get(key) ?? 0) + 1);
  }
  return [...grouped.entries()].sort(([a], [b]) => (a > b ? 1 : -1));
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
