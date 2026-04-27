import {
  ChecklistColumnValidationSummary,
  NormalizedChecklistAnswer,
  NormalizedChecklistEntry,
  NormalizedDataset,
  ParsedTabularFile,
  RowMap,
} from "@/lib/types";
import { isMissing, normalizeHeader, toStringValue } from "@/lib/utils";

const MIN_NON_EMPTY_RATIO = 0.08;
const INSPECTION_PREFIX_REPAIR_REGEX = /^inspecti[\s_-]*n[\s_-]*/i;
const INSPECTION_NOTES_SUFFIX_REGEX = /(?:_|-)notes?$/i;
const INSPECTION_TIMESTAMP_SUFFIX_REGEX = /(?:_|-)timestamp$/i;
const CHECKLIST_ANSWER_TOKENS = new Set([
  "sim",
  "yes",
  "true",
  "nao",
  "no",
  "false",
  "na",
  "n/a",
  "nao se aplica",
  "not applicable",
]);
const EXCLUDED_ADMIN_FIELDS = new Set([
  "auditid",
  "auditname",
  "templateid",
  "templatename",
  "author",
  "owner",
  "start",
  "lastupdate",
  "completed",
  "score",
  "totalscore",
]);
const EXCLUDED_ADMIN_PREFIXES = ["title_page_", "title page_"];
const EXCLUDED_CONCLUSION_PREFIXES = [
  "inspection_dados_do_estabelecimento_",
  "inspection_observacoes_",
  "inspection_assinatura",
  "inspection_classificacao_de_risco",
  "inspection_nivel_de_risco_sanitario",
  "inspection_necessita_acao_imediata",
];
const EXCLUDED_CONCLUSION_CONTAINS = ["multa", "interdicao"];

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

function normalizeInternalHeader(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\?/g, " ")
    .replace(/[^a-z0-9_ -]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(INSPECTION_PREFIX_REPAIR_REGEX, "inspection_")
    .replace(/[\s-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function normalizeChecklistAnswer(value: unknown): NormalizedChecklistAnswer {
  const normalized = toStringValue(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/\s*\/\s*/g, "/")
    .replace(/\s+/g, " ");

  if (!normalized || normalized === "null" || normalized === "undefined") {
    return "na";
  }
  if (normalized === "sim" || normalized === "yes" || normalized === "true") {
    return "sim";
  }
  if (normalized === "nao" || normalized === "no" || normalized === "false") {
    return "nao";
  }
  if (
    normalized === "na" ||
    normalized === "n/a" ||
    normalized === "nao se aplica" ||
    normalized === "not applicable"
  ) {
    return "na";
  }
  return "na";
}

function hasChecklistLikeAnswerValues(rows: RowMap[], column: string): boolean {
  let nonEmpty = 0;
  let recognized = 0;
  let unknown = 0;

  for (const row of rows) {
    const raw = toStringValue(row[column]);
    const normalized = raw
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .trim()
      .replace(/\s*\/\s*/g, "/")
      .replace(/\s+/g, " ");
    if (!normalized) {
      continue;
    }
    nonEmpty += 1;
    if (CHECKLIST_ANSWER_TOKENS.has(normalized)) {
      recognized += 1;
    } else {
      unknown += 1;
    }
  }

  if (nonEmpty === 0) {
    return false;
  }
  return recognized >= unknown;
}

function extractSectionAndQuestion(normalizedColumnName: string): { section: string; question: string } {
  const core = normalizedColumnName.replace(/^inspection_/, "");
  const firstUnderscore = core.indexOf("_");
  if (firstUnderscore < 0) {
    const value = core.replace(/_/g, " ").trim();
    return {
      section: value || "sem secao",
      question: value || "(pergunta nao identificada)",
    };
  }

  const rawSection = core.slice(0, firstUnderscore).replace(/_/g, " ").trim();
  const rawQuestion = core.slice(firstUnderscore + 1).replace(/_/g, " ").trim();
  return {
    section: rawSection || "sem secao",
    question: rawQuestion || "(pergunta nao identificada)",
  };
}

function classifyInspectionColumn(
  normalizedColumnName: string,
  rows: RowMap[],
  lookupColumnName: string,
): "valid" | "notes" | "admin" | "conclusion" {
  if (!normalizedColumnName.startsWith("inspection_")) {
    return "admin";
  }
  if (INSPECTION_NOTES_SUFFIX_REGEX.test(normalizedColumnName)) {
    return "notes";
  }
  if (INSPECTION_TIMESTAMP_SUFFIX_REGEX.test(normalizedColumnName)) {
    return "notes";
  }

  const core = normalizedColumnName.replace(/^inspection_/, "");
  if (EXCLUDED_ADMIN_FIELDS.has(core)) {
    return "admin";
  }
  if (EXCLUDED_ADMIN_PREFIXES.some((prefix) => core.startsWith(prefix))) {
    return "admin";
  }
  if (
    EXCLUDED_CONCLUSION_PREFIXES.some((prefix) => normalizedColumnName.startsWith(prefix)) ||
    EXCLUDED_CONCLUSION_CONTAINS.some((needle) => normalizedColumnName.includes(needle))
  ) {
    return "conclusion";
  }
  if (!hasChecklistLikeAnswerValues(rows, lookupColumnName)) {
    return "admin";
  }
  return "valid";
}

function extractRowValueByCandidates(
  row: RowMap,
  candidates: string[],
  originalHeadersByNormalized: Record<string, string>,
): string {
  for (const key of candidates) {
    const normalized = normalizeInternalHeader(key);
    const direct = toStringValue(row[normalized]);
    if (direct) {
      return direct;
    }
    const originalKey =
      originalHeadersByNormalized[normalized] ??
      originalHeadersByNormalized[key] ??
      key;
    const byOriginal = toStringValue(row[originalKey]);
    if (byOriginal) {
      return byOriginal;
    }
  }
  return "";
}

export function normalizeDataset(parsed: ParsedTabularFile): NormalizedDataset {
  const notes: string[] = [];
  if (parsed.errors.length > 0) {
    notes.push(
      `Foram encontrados ${parsed.errors.length} erro(s) de parsing; resultado parcial foi preservado.`,
    );
  }
  const { headers, duplicateHeaders } = dedupeHeaders(parsed.headers);
  const originalHeaderByNormalized: Record<string, string> = {};
  const normalizedHeaderByOriginal: Record<string, string> = {};
  const mappedRows: RowMap[] = parsed.rows.map((rawRow) => {
    const normalizedRow: RowMap = {};
    headers.forEach((header, index) => {
      const sourceHeader = parsed.headers[index];
      const originalLabel = toStringValue(sourceHeader);
      const internalHeader = normalizeInternalHeader(header);
      originalHeaderByNormalized[internalHeader] = originalLabel || header;
      normalizedHeaderByOriginal[originalLabel || header] = internalHeader;
      normalizedRow[internalHeader] = normalizeCell(rawRow[sourceHeader]);
    });
    return normalizedRow;
  });

  const removedColumns: string[] = [];
  const normalizedHeaders = [...new Set(headers.map((header) => normalizeInternalHeader(header)).filter(Boolean))];
  const keptHeaders = normalizedHeaders.filter((header) => {
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

  const validChecklistQuestionColumns: string[] = [];
  const excludedNotesColumns: string[] = [];
  const excludedAdminColumns: string[] = [];
  const excludedConclusionColumns: string[] = [];

  for (const column of keptHeaders) {
    const kind = classifyInspectionColumn(column, rows, column);
    if (kind === "valid") {
      validChecklistQuestionColumns.push(column);
    } else if (kind === "notes") {
      excludedNotesColumns.push(column);
    } else if (kind === "conclusion") {
      excludedConclusionColumns.push(column);
    } else {
      excludedAdminColumns.push(column);
    }
  }

  const normalizedChecklistEntries: NormalizedChecklistEntry[] = [];
  const auditIdCandidates = ["auditid", "audit_id"];
  const unitNameCandidates = ["auditname", "audit_name", "title_page_nome", "title_page_name", "owner"];

  for (const row of rows) {
    const auditId = extractRowValueByCandidates(row, auditIdCandidates, originalHeaderByNormalized);
    const unitName = extractRowValueByCandidates(row, unitNameCandidates, originalHeaderByNormalized);

    for (const column of validChecklistQuestionColumns) {
      const { section, question } = extractSectionAndQuestion(column);
      const originalColumnName = originalHeaderByNormalized[column] ?? column;
      const originalAnswer = toStringValue(row[column]);
      normalizedChecklistEntries.push({
        fileName: parsed.fileName,
        auditId,
        unitName,
        section,
        question,
        originalColumnName,
        normalizedColumnName: column,
        originalAnswer,
        normalizedAnswer: normalizeChecklistAnswer(originalAnswer),
      });
    }
  }

  const answerCounts = normalizedChecklistEntries.reduce(
    (acc, entry) => {
      acc[entry.normalizedAnswer] += 1;
      return acc;
    },
    { sim: 0, nao: 0, na: 0 } as Record<NormalizedChecklistAnswer, number>,
  );
  const checklistValidationSummary: ChecklistColumnValidationSummary = {
    totalOriginalColumns: parsed.headers.length,
    totalValidChecklistQuestionColumns: validChecklistQuestionColumns.length,
    totalExcludedNotesColumns: excludedNotesColumns.length,
    totalExcludedMetadataAdminColumns: excludedAdminColumns.length,
    totalExcludedConclusionRiskSignatureColumns: excludedConclusionColumns.length,
    totalNormalizedChecklistAnswers: normalizedChecklistEntries.length,
    normalizedAnswerCounts: {
      sim: answerCounts.sim,
      nao: answerCounts.nao,
      na: answerCounts.na,
    },
    validChecklistColumns: validChecklistQuestionColumns,
    first10ValidChecklistQuestions: validChecklistQuestionColumns.slice(0, 10),
    first10ExcludedAdminConclusionFields: [...excludedAdminColumns, ...excludedConclusionColumns].slice(0, 10),
    excludedConclusionFields: excludedConclusionColumns,
  };

  return {
    headers: keptHeaders,
    rows,
    duplicateHeaders,
    removedColumns,
    normalizationNotes: notes,
    rawWarnings: parsed.warnings,
    originalHeaderByNormalized,
    normalizedHeaderByOriginal,
    normalizedChecklistEntries,
    checklistValidationSummary,
  };
}
