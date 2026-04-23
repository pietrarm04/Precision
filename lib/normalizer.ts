import { NormalizedDataset, ParsedTabularFile, RowMap } from "@/lib/types";
import { isMissing, normalizeHeader, toStringValue } from "@/lib/utils";

const MIN_NON_EMPTY_RATIO = 0.08;

function dedupeHeaders(headers: string[]): { headers: string[]; duplicateHeaders: string[] } {
  const seen = new Map<string, number>();
  const duplicateHeaders: string[] = [];
  const deduped = headers.map((header, index) => {
    const normalized = normalizeHeader(header, index);
    const count = seen.get(normalized) ?? 0;
    seen.set(normalized, count + 1);
    if (count === 0) {
      return normalized;
    }
    const dedupedName = `${normalized}_${count + 1}`;
    duplicateHeaders.push(normalized);
    return dedupedName;
  });
  return { headers: deduped, duplicateHeaders };
}

function normalizeCell(value: unknown): string {
  const text = toStringValue(value)
    .replace(/\u00A0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) {
    return "";
  }
  if (/^(null|undefined|nan|n\/a|na)$/i.test(text)) {
    return "";
  }
  return text;
}

export function normalizeDataset(parsed: ParsedTabularFile): NormalizedDataset {
  const notes: string[] = [];
  const { headers, duplicateHeaders } = dedupeHeaders(parsed.headers);
  const mappedRows: RowMap[] = parsed.rows.map((rawRow) => {
    const normalizedRow: RowMap = {};
    headers.forEach((header, index) => {
      const sourceHeader = parsed.headers[index];
      normalizedRow[header] = normalizeCell(rawRow[sourceHeader]);
    });
    return normalizedRow;
  });

  const removedColumns: string[] = [];
  const keptHeaders = headers.filter((header) => {
    const filled = mappedRows.reduce((sum, row) => sum + (isMissing(row[header]) ? 0 : 1), 0);
    const ratio = mappedRows.length === 0 ? 0 : filled / mappedRows.length;
    if (ratio < MIN_NON_EMPTY_RATIO) {
      removedColumns.push(header);
      return false;
    }
    return true;
  });

  if (removedColumns.length > 0) {
    notes.push(`Removidas ${removedColumns.length} colunas quase vazias.`);
  }
  if (duplicateHeaders.length > 0) {
    notes.push(`Ajustados nomes de colunas duplicadas: ${duplicateHeaders.slice(0, 4).join(", ")}.`);
  }
  if (parsed.warnings.length > 0) {
    notes.push("Foram detectados sinais de estrutura inconsistente no arquivo original.");
  }

  const rows = mappedRows
    .map((row) => {
      const out: RowMap = {};
      keptHeaders.forEach((header) => {
        out[header] = row[header];
      });
      return out;
    })
    .filter((row) => Object.values(row).some((value) => !isMissing(value)));

  return {
    headers: keptHeaders,
    rows,
    duplicateHeaders,
    removedColumns,
    normalizationNotes: notes,
    rawWarnings: parsed.warnings,
  };
}
