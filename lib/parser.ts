import Papa from "papaparse";
import * as XLSX from "xlsx";
import { ParsedTabularFile, RowMap } from "@/lib/types";
import { toStringValue } from "@/lib/utils";

const MAX_ROWS = 50_000;
const HEADER_SCAN_LIMIT = 18;
const INSPECTION_PREFIX_TYPO_REGEX = /^\s*inspecti\s+n[\s_-]*/i;
const INSPECTION_PREFIX_REGEX = /^\s*inspection[\s_-]*/i;

function normalizeInternalKey(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[?]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function normalizeSafetyCultureHeaderRaw(header: string): string {
  let fixed = toStringValue(header).replace(/\u00A0/g, " ").replace(/\s+/g, " ").trim();
  if (INSPECTION_PREFIX_TYPO_REGEX.test(fixed)) {
    fixed = fixed.replace(INSPECTION_PREFIX_TYPO_REGEX, "inspection_");
  } else if (INSPECTION_PREFIX_REGEX.test(fixed)) {
    fixed = fixed.replace(INSPECTION_PREFIX_REGEX, "inspection_");
  }
  return fixed;
}

function normalizeSafetyCultureHeaderKey(header: string, index: number): string {
  const raw = normalizeSafetyCultureHeaderRaw(header);
  const normalized = normalizeInternalKey(raw);
  return normalized || `coluna_${index + 1}`;
}

function matrixFromCsv(buffer: Buffer): { matrix: string[][]; warnings: string[]; errors: string[] } {
  const csv = buffer.toString("utf-8");
  const parsed: Papa.ParseResult<string[]> = Papa.parse<string[]>(csv, {
    skipEmptyLines: false,
    delimiter: "",
    dynamicTyping: false,
  });
  const warnings: string[] = [];
  const errors: string[] = [];
  for (const parseError of parsed.errors) {
    const rowLabel =
      parseError.row !== undefined && parseError.row !== null ? `linha ${parseError.row + 1}` : "linha desconhecida";
    const message = `CSV ${rowLabel}: ${parseError.message}`;
    if (parseError.code === "UndetectableDelimiter") {
      warnings.push(message);
      continue;
    }
    warnings.push(message);
  }

  const matrix = parsed.data.map((row: string[]) => row.map((cell: string) => toStringValue(cell)));
  if (matrix.length > 0 && matrix[0].length > 0) {
    matrix[0][0] = matrix[0][0].replace(/^\uFEFF/, "");
  }
  if (matrix.length === 0) {
    errors.push("CSV sem linhas legiveis apos parsing.");
  }

  return { matrix, warnings, errors };
}

function matrixFromExcel(buffer: Buffer): string[][] {
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: false });
  const firstSheet = workbook.SheetNames[0];
  if (!firstSheet) {
    throw new Error("Planilha sem abas disponiveis.");
  }
  const sheet = workbook.Sheets[firstSheet];
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    blankrows: true,
    raw: false,
  });
  return matrix.map((row) => row.map((cell) => toStringValue(cell)));
}

function rowScoreForHeader(row: string[]): number {
  const nonEmpty = row.filter((cell) => cell.trim().length > 0);
  if (nonEmpty.length === 0) {
    return -100;
  }
  const unique = new Set(nonEmpty.map((cell) => cell.toLowerCase())).size;
  const numeric = nonEmpty.filter((cell) => /^[\d.,\-R$%]+$/.test(cell)).length;
  const keyword = nonEmpty.filter((cell) =>
    /(question|pergunta|resposta|answer|section|categoria|status|date|data|id|nome|value|valor)/i.test(cell),
  ).length;
  return nonEmpty.length * 2 + unique - numeric * 1.4 + keyword * 2.2;
}

function detectHeaderIndex(matrix: string[][]): number {
  const scan = matrix.slice(0, HEADER_SCAN_LIMIT);
  let bestIndex = 0;
  let bestScore = -Infinity;
  scan.forEach((row, index) => {
    const score = rowScoreForHeader(row);
    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  });
  return bestIndex;
}

function prepareRows(matrix: string[][], headerIndex: number): { headers: string[]; rows: RowMap[]; warnings: string[] } {
  const warnings: string[] = [];
  const dataRows = matrix.slice(headerIndex + 1);
  const maxColumns = Math.max(
    matrix[headerIndex]?.length ?? 0,
    ...dataRows.slice(0, 1000).map((row) => row.length),
  );
  const rawHeaders = new Array(maxColumns).fill(null).map((_, index) => matrix[headerIndex]?.[index] ?? "");
  const headers = rawHeaders.map((header, index) => normalizeSafetyCultureHeaderKey(header, index));
  const originalHeadersByNormalized: Record<string, string> = {};
  headers.forEach((header, index) => {
    if (!originalHeadersByNormalized[header]) {
      originalHeadersByNormalized[header] = normalizeSafetyCultureHeaderRaw(rawHeaders[index] ?? "");
    }
  });
  const inconsistentRows = dataRows.filter((row) => row.length !== maxColumns).length;
  if (headerIndex > 0) {
    warnings.push(
      `Cabecalho detectado na linha ${headerIndex + 1}; linhas anteriores podem conter metadados misturados.`,
    );
  }
  if (inconsistentRows > 0) {
    warnings.push(`${inconsistentRows} linhas com quantidade de colunas inconsistente.`);
  }

  const rows = dataRows
    .slice(0, MAX_ROWS)
    .map((row) => {
      const mapped: RowMap = {};
      headers.forEach((header, index) => {
        mapped[header] = toStringValue(row[index] ?? "");
      });
      return mapped;
    })
    .filter((row) => Object.values(row).some((value) => toStringValue(value).length > 0));

  if (rows.length > 0) {
    rows.forEach((row) => {
      row.__originalHeadersByNormalized = originalHeadersByNormalized;
    });
  }

  return { headers, rows, warnings };
}

export function parseTabularFile(fileName: string, bytes: ArrayBuffer): ParsedTabularFile {
  const lower = fileName.toLowerCase();
  const extension = lower.endsWith(".csv") ? "csv" : lower.endsWith(".xlsx") ? "xlsx" : lower.endsWith(".xls") ? "xls" : null;
  if (!extension) {
    throw new Error("Formato nao suportado. Use CSV, XLSX ou XLS.");
  }

  const buffer = Buffer.from(bytes);
  const warnings: string[] = [];
  const errors: string[] = [];

  let matrix: string[][] = [];
  try {
    if (extension === "csv") {
      const csvParsed = matrixFromCsv(buffer);
      matrix = csvParsed.matrix;
      warnings.push(...csvParsed.warnings);
      errors.push(...csvParsed.errors);
    } else {
      matrix = matrixFromExcel(buffer);
    }
  } catch (error) {
    errors.push(error instanceof Error ? error.message : "Falha ao ler o arquivo tabular.");
  }

  if (matrix.length === 0) {
    return {
      fileName,
      extension,
      headers: [],
      originalHeaders: [],
      rows: [],
      warnings,
      errors: errors.length > 0 ? errors : ["Arquivo vazio ou sem linhas legiveis."],
    };
  }

  const headerIndex = detectHeaderIndex(matrix);
  const prepared = prepareRows(matrix, headerIndex);
  warnings.push(...prepared.warnings);

  const headers = prepared.headers;
  const rows = prepared.rows;
  if (headers.length === 0) {
    errors.push("Nao foi possivel identificar cabecalhos confiaveis.");
  }
  if (rows.length === 0) {
    warnings.push("Arquivo lido, mas sem linhas de dados aproveitaveis apos limpeza.");
  }

  return {
    fileName,
    extension,
    headers,
    originalHeaders: headers.map((header) => {
      const firstRow = rows[0];
      if (firstRow && typeof firstRow.__originalHeadersByNormalized === "object") {
        const lookup = firstRow.__originalHeadersByNormalized as Record<string, string>;
        return lookup[header] ?? header;
      }
      return header;
    }),
    rows,
    warnings,
    errors,
  };
}
