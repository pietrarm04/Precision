import Papa from "papaparse";
import * as XLSX from "xlsx";
import { ParsedTabularFile, RowMap } from "@/lib/types";
import { normalizeHeader, toStringValue } from "@/lib/utils";

const MAX_ROWS = 50_000;
const HEADER_SCAN_LIMIT = 18;

function matrixFromCsv(buffer: Buffer): string[][] {
  const csv = buffer.toString("utf-8");
  const parsed = Papa.parse<string[]>(csv, {
    skipEmptyLines: false,
  });
  return parsed.data.map((row: string[]) => row.map((cell: string) => toStringValue(cell)));
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
  const headers = rawHeaders.map((header, index) => normalizeHeader(header, index));
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
    rows,
    warnings,
    errors,
  };
}
