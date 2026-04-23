import { DatasetType, DatasetTypeInference, RowMap } from "@/lib/types";
import { inferDataType, isMissing, normalizeHeader, safeNumber, toDate, toStringValue } from "@/lib/utils";

const DATASET_KEYWORDS: Record<Exclude<DatasetType, "generic">, string[]> = {
  sales: ["venda", "sales", "revenue", "faturamento", "produto", "cliente"],
  finance: ["finance", "finan", "despesa", "receita", "custo", "orcamento", "conta"],
  inventory: ["estoque", "inventory", "sku", "item", "quantidade", "warehouse"],
  survey_satisfaction: ["pesquisa", "survey", "satisfacao", "nota", "nps", "resposta"],
  productivity: ["produtividade", "task", "tempo", "efficiency", "turnaround"],
  inspection_checklist: [
    "inspec",
    "checklist",
    "audit",
    "conforme",
    "nao conforme",
    "pass",
    "fail",
    "safetyculture",
    "item",
    "question",
    "pergunta",
  ],
  operations_maintenance: ["operacao", "manutencao", "maintenance", "downtime", "os", "equipamento"],
};

const POSITIVE_RESPONSE = [
  "sim",
  "yes",
  "conforme",
  "ok",
  "pass",
  "aprovado",
  "true",
];

const NEGATIVE_RESPONSE = [
  "nao",
  "não",
  "no",
  "nao conforme",
  "não conforme",
  "fail",
  "reprovado",
  "false",
];

const NOT_APPLICABLE_RESPONSE = ["n/a", "na", "não aplicável", "nao aplicavel", "not applicable"];

const NEGATIVE_QUESTION_HINTS = [
  "vazamento",
  "odor",
  "praga",
  "risco",
  "falta",
  "defeito",
  "danificado",
  "problema",
  "contamin",
  "sujeira",
  "obstru",
  "quebrado",
  "falha",
];

const POSITIVE_QUESTION_HINTS = [
  "conforme",
  "limpo",
  "adequado",
  "regular",
  "correto",
  "funcionando",
  "seguro",
  "calibrado",
  "validado",
];

export function inferDatasetType(headers: string[], rows: RowMap[]): DatasetTypeInference {
  const normalizedHeaders = headers.map((h) => normalizeHeader(h));
  const sampleRows = rows.slice(0, 200);
  const scores: Record<DatasetType, number> = {
    sales: 0,
    finance: 0,
    inventory: 0,
    survey_satisfaction: 0,
    productivity: 0,
    inspection_checklist: 0,
    operations_maintenance: 0,
    generic: 0,
  };
  const reasons: string[] = [];

  for (const [type, keywords] of Object.entries(DATASET_KEYWORDS) as [
    Exclude<DatasetType, "generic">,
    string[],
  ][]) {
    for (const header of normalizedHeaders) {
      if (keywords.some((kw) => header.includes(kw))) {
        scores[type] += 2;
      }
    }
    for (const row of sampleRows) {
      const rowText = Object.values(row).join(" ").toLowerCase();
      if (keywords.some((kw) => rowText.includes(kw))) {
        scores[type] += 0.8;
      }
    }
  }

  const binarySignal = sampleRows.reduce(
    (acc, row) => {
      for (const value of Object.values(row)) {
        const v = toStringValue(value).toLowerCase();
        if (POSITIVE_RESPONSE.includes(v) || NEGATIVE_RESPONSE.includes(v) || NOT_APPLICABLE_RESPONSE.includes(v)) {
          acc += 1;
        }
      }
      return acc;
    },
    0,
  );
  if (binarySignal > sampleRows.length * 2) {
    scores.inspection_checklist += 5;
    scores.survey_satisfaction += 2;
    reasons.push("Presenca forte de respostas binarias/categoricas.");
  }

  if (normalizedHeaders.some((h) => h.includes("section") || h.includes("secao"))) {
    scores.inspection_checklist += 3;
    reasons.push("Colunas de secao/subsecao detectadas.");
  }

  if (normalizedHeaders.some((h) => h.includes("date") || h.includes("data"))) {
    scores.sales += 1;
    scores.finance += 1;
    scores.operations_maintenance += 1;
  }

  let winner: DatasetType = "generic";
  let max = -1;
  for (const [type, score] of Object.entries(scores) as [DatasetType, number][]) {
    if (score > max) {
      winner = type;
      max = score;
    }
  }
  const sorted = Object.values(scores).sort((a, b) => b - a);
  const confidenceRaw = max <= 0 ? 0.25 : Math.max(0.3, Math.min(0.98, max / (max + (sorted[1] ?? 1))));
  reasons.push(`Classificacao guiada por nomes de colunas e padroes de valores.`);

  return {
    datasetType: winner,
    confidence: Number(confidenceRaw.toFixed(2)),
    reasons,
    scores,
  };
}

export type ColumnKind = "numeric" | "date" | "categorical" | "text" | "empty";

export function detectColumnKinds(headers: string[], rows: RowMap[]): Record<string, ColumnKind> {
  const kinds: Record<string, ColumnKind> = {};
  const sampleRows = rows.slice(0, 500);
  for (const header of headers) {
    let numeric = 0;
    let date = 0;
    let textLike = 0;
    let total = 0;
    for (const row of sampleRows) {
      const value = row[header];
      if (value === "" || value == null) {
        continue;
      }
      total += 1;
      if (safeNumber(value) != null) {
        numeric += 1;
      } else if (inferDataType([value]) === "date") {
        date += 1;
      } else if (toStringValue(value).length > 30) {
        textLike += 1;
      }
    }
    if (total === 0) kinds[header] = "empty";
    else if (numeric / total > 0.75) kinds[header] = "numeric";
    else if (date / total > 0.65) kinds[header] = "date";
    else if (textLike / total > 0.4) kinds[header] = "text";
    else kinds[header] = "categorical";
  }
  return kinds;
}

export type StructuralQualityReport = {
  score: number;
  label: "clean" | "intermediate" | "messy";
  issues: string[];
};

export function assessStructuralQuality(headers: string[], rows: RowMap[]): StructuralQualityReport {
  const issues: string[] = [];
  const rowCount = rows.length;
  const colCount = headers.length;
  if (!rowCount || !colCount) {
    return { score: 0.1, label: "messy", issues: ["Arquivo sem dados suficientes para analise."] };
  }

  let score = 1;
  const badHeaders = headers.filter((h) => {
    const normalized = normalizeHeader(h);
    return !normalized || normalized === "unnamed" || /^column_\d+$/.test(normalized);
  });
  if (badHeaders.length > 0) {
    const penalty = Math.min(0.25, badHeaders.length / colCount / 1.5);
    score -= penalty;
    issues.push(`Cabecalhos pouco descritivos em ${badHeaders.length} coluna(s).`);
  }

  const emptinessByColumn = headers.map((h) => {
    let empty = 0;
    for (const row of rows) {
      if (isMissing(row[h])) empty += 1;
    }
    return empty / rowCount;
  });
  const verySparse = emptinessByColumn.filter((r) => r > 0.75).length;
  if (verySparse > 0) {
    score -= Math.min(0.25, (verySparse / colCount) * 0.35);
    issues.push(`Muitas colunas com baixa densidade de dados (${verySparse}).`);
  }

  const inconsistentRows = rows.filter(
    (row) => Object.values(row).filter((v) => !isMissing(v)).length < Math.max(1, colCount * 0.2),
  ).length;
  if (inconsistentRows / rowCount > 0.15) {
    score -= 0.2;
    issues.push("Ha muitas linhas com poucos valores preenchidos.");
  }

  score = Math.max(0.05, Number(score.toFixed(2)));
  const label = score > 0.75 ? "clean" : score > 0.45 ? "intermediate" : "messy";
  return { score, label, issues };
}

export type InspectionInterpretation = "real_failure" | "ok" | "not_applicable" | "undetermined";

export function classifyQuestionPolarity(question: string): "positive" | "negative" | "neutral" {
  const q = question.toLowerCase();
  const negativeHits = NEGATIVE_QUESTION_HINTS.filter((w) => q.includes(w)).length;
  const positiveHits = POSITIVE_QUESTION_HINTS.filter((w) => q.includes(w)).length;
  if (negativeHits > positiveHits) return "negative";
  if (positiveHits > negativeHits) return "positive";
  return "neutral";
}

export function interpretInspectionResponse(
  question: string,
  response: string,
  userMode: "automatic" | "yesMeansFailure" | "noMeansFailure" | "keepAutomatic",
): InspectionInterpretation {
  const normalizedResponse = response.trim().toLowerCase();
  if (!normalizedResponse) return "undetermined";
  if (NOT_APPLICABLE_RESPONSE.includes(normalizedResponse)) return "not_applicable";
  if (["unknown", "talvez", "pendente"].includes(normalizedResponse)) return "undetermined";

  const positiveLike = POSITIVE_RESPONSE.includes(normalizedResponse);
  const negativeLike = NEGATIVE_RESPONSE.includes(normalizedResponse);
  if (!positiveLike && !negativeLike) return "undetermined";

  if (userMode === "yesMeansFailure") {
    if (positiveLike) return "real_failure";
    if (negativeLike) return "ok";
  }
  if (userMode === "noMeansFailure") {
    if (negativeLike) return "real_failure";
    if (positiveLike) return "ok";
  }

  const polarity = classifyQuestionPolarity(question);

  if (positiveLike) {
    if (polarity === "negative") return "real_failure";
    return "ok";
  }

  if (negativeLike) {
    if (polarity === "negative") return "ok";
    return "real_failure";
  }

  return "undetermined";
}

export function detectLikelyInspectionColumns(headers: string[]): {
  questionColumn?: string;
  responseColumn?: string;
  sectionColumn?: string;
  dateColumn?: string;
} {
  const lower = headers.map((h) => ({ original: h, lower: h.toLowerCase() }));
  const questionColumn = lower.find((h) => /question|pergunta|item|criteria|criterio/.test(h.lower))?.original;
  const responseColumn = lower.find((h) => /answer|resposta|response|resultado|status/.test(h.lower))?.original;
  const sectionColumn = lower.find((h) => /section|secao|área|area|categoria|grupo/.test(h.lower))?.original;
  const dateColumn = lower.find((h) => /date|data|inspection.*at|created|submitted/.test(h.lower))?.original;
  return { questionColumn, responseColumn, sectionColumn, dateColumn };
}

export function normalizeInspectionRow(
  row: RowMap,
  columns: { questionColumn?: string; responseColumn?: string; sectionColumn?: string; dateColumn?: string },
  mode: "automatic" | "yesMeansFailure" | "noMeansFailure" | "keepAutomatic",
): {
  question: string;
  response: string;
  section: string;
  date: string;
  interpretation: InspectionInterpretation;
} {
  const question = String(columns.questionColumn ? row[columns.questionColumn] ?? "" : "").trim();
  const response = String(columns.responseColumn ? row[columns.responseColumn] ?? "" : "").trim();
  const section = String(columns.sectionColumn ? row[columns.sectionColumn] ?? "" : "Sem secao").trim() || "Sem secao";
  const dateRaw = columns.dateColumn ? String(row[columns.dateColumn] ?? "") : "";
  const date = toDate(dateRaw) ?? "";
  const interpretation = interpretInspectionResponse(question, response, mode);
  return { question, response, section, date, interpretation };
}

