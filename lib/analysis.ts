import {
  AnalysisResult,
  ColumnType,
  DashboardCustomizationConfig,
  DashboardGrouping,
  DashboardWidget,
  DatasetType,
  DatasetTypeInference,
  KpiKey,
  ManualReviewConfig,
  NormalizedDataset,
  ParsedTabularFile,
  QAItem,
  QAOutcome,
  SemanticQuestionPolarity,
  SourceScoreSummary,
  WeightedIssue,
} from "@/lib/types";
import {
  average,
  bucketByMonth,
  clamp,
  countBy,
  inferDataType,
  isMissing,
  median,
  normalizeHeader,
  safeNumber,
  toDate,
  toStringValue,
  topN,
} from "@/lib/utils";

type SummaryCard = {
  label: string;
  value: string;
  emphasis?: "default" | "success" | "warning" | "danger";
};

const DEFAULT_WEIGHT = 1;
const MAX_CATEGORY_FOR_BAR = 12;
const MAX_WIDGETS_HIGH_RELIABILITY = 4;
const MAX_WIDGETS_MEDIUM_RELIABILITY = 2;
const MAX_WIDGETS_LOW_RELIABILITY = 1;

const statusPassTokens = [
  "conforme",
  "ok",
  "pass",
  "aprovado",
  "atendido",
  "compliant",
  "positivo",
];
const statusFailTokens = [
  "nao conforme",
  "não conforme",
  "fail",
  "falha",
  "reprovado",
  "defeito",
  "inadequado",
  "negativo",
];
const naTokens = ["na", "n/a", "não se aplica", "nao se aplica", "not applicable"];
const yesTokens = ["sim", "yes", "y", "true", "1"];
const noTokens = ["nao", "não", "no", "n", "false", "0"];
const inspectionPrefixRegex = /^inspection(?:[_\s-]|$)/i;
const inspectionIgnoredCoreRegex =
  /(^|_)(auditid|audit_id|score|totalscore|total_score|title_page|titlepage|title|page_title)(_|$)/i;

const defaultIgnoredRegex = /(coment[aá]rio|evid[eê]ncia|foto|anexo|assinatura|observa[cç][aã]o)/i;

const DEFAULT_DASHBOARD_CONFIG: DashboardCustomizationConfig = {
  selectedKpis: [],
  grouping: "loja",
  kpiTargets: {},
  visibleSections: {
    kpiOverview: true,
    sanitaryPerformance: true,
    okr: true,
    risk: true,
  },
  okrs: [],
};

const ALL_KPI_KEYS: KpiKey[] = [
  "ics_medio",
  "ics_minimo",
  "ics_maximo",
  "desvio_padrao_ics",
  "total_nao_conformidades",
  "nao_conformidades_criticas",
  "percentual_nao_conformidade",
  "percentual_nao_aplicavel",
  "score_medio",
  "quantidade_inspecoes",
];

DEFAULT_DASHBOARD_CONFIG.selectedKpis = ALL_KPI_KEYS;

const KPI_LABELS: Record<KpiKey, string> = {
  ics_medio: "ICS médio",
  ics_minimo: "ICS mínimo",
  ics_maximo: "ICS máximo",
  desvio_padrao_ics: "Desvio padrão do ICS",
  total_nao_conformidades: "Total de não conformidades",
  nao_conformidades_criticas: "Não conformidades críticas",
  percentual_nao_conformidade: "% de não conformidade",
  percentual_nao_aplicavel: "% de não aplicável",
  score_medio: "Score médio",
  quantidade_inspecoes: "Quantidade de inspeções",
};

type StatusLevel = "atingido" | "atencao" | "critico";
type RiskLevel = "baixo_risco" | "atencao" | "possivel_multa" | "possivel_interdicao";

type GroupInspectionStats = {
  group: string;
  total: number;
  evaluated: number;
  failures: number;
  nonFailures: number;
  na: number;
  undetermined: number;
  criticalFailures: number;
  ics: number;
  failureRate: number;
};

function detectColumnTypes(dataset: NormalizedDataset): Record<string, ColumnType> {
  const types: Record<string, ColumnType> = {};
  for (const header of dataset.headers) {
    const values = dataset.rows.map((row) => row[header]);
    types[header] = inferDataType(values);
  }
  return types;
}

function structuralQuality(dataset: NormalizedDataset): {
  score: number;
  label: "limpo" | "intermediario" | "baguncado";
  notes: string[];
} {
  const notes: string[] = [...dataset.normalizationNotes];
  const totalCells = dataset.rows.length * Math.max(dataset.headers.length, 1);
  const missingCells = dataset.rows.reduce((sum, row) => {
    return (
      sum +
      dataset.headers.reduce((acc, header) => {
        return acc + (isMissing(row[header]) ? 1 : 0);
      }, 0)
    );
  }, 0);
  const missingRatio = totalCells > 0 ? missingCells / totalCells : 1;
  const duplicateHeaderPenalty = dataset.duplicateHeaders.length * 0.04;
  const lowDataPenalty = dataset.rows.length < 10 ? 0.08 : 0;
  const score = clamp(1 - missingRatio * 0.65 - duplicateHeaderPenalty - lowDataPenalty, 0, 1);

  if (missingRatio > 0.35) {
    notes.push("Muitos valores ausentes detectados, reduzindo confiabilidade analitica.");
  }
  if (dataset.headers.length < 3) {
    notes.push("Poucas colunas identificadas para analise ampla.");
  }
  if (dataset.rawWarnings.length > 0) {
    notes.push("O parser detectou sinais de inconsistencias estruturais.");
  }

  const label = score >= 0.76 ? "limpo" : score >= 0.5 ? "intermediario" : "baguncado";
  return { score, label, notes };
}

function confidenceFromScore(score: number): number {
  if (score > 1) {
    return clamp(score / 100, 0, 1);
  }
  return clamp(score, 0, 1);
}

function parseAsOutcome(rawValue: unknown): QAOutcome {
  const normalized = toStringValue(rawValue).toLowerCase().trim();
  if (!normalized) {
    return "unknown";
  }
  if (naTokens.some((token) => normalized === token || normalized.includes(token))) {
    return "na";
  }
  if (statusFailTokens.some((token) => normalized.includes(token))) {
    return "fail";
  }
  if (statusPassTokens.some((token) => normalized.includes(token))) {
    return "pass";
  }
  if (yesTokens.includes(normalized)) {
    return "yes";
  }
  if (noTokens.includes(normalized)) {
    return "no";
  }
  return "unknown";
}

function normalizeInspectionHeaderCore(header: string): string {
  const normalized = header
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_")
    .replace(/^inspection(?:_+)?/, "");
  return normalized;
}

function isInspectionQuestionColumn(header: string): boolean {
  if (!inspectionPrefixRegex.test(header)) {
    return false;
  }
  const core = normalizeInspectionHeaderCore(header);
  if (!core) {
    return false;
  }
  if (core.endsWith("_note") || core.endsWith("_notes")) {
    return false;
  }
  if (inspectionIgnoredCoreRegex.test(core)) {
    return false;
  }
  return true;
}

function deriveSectionAndQuestionFromInspectionColumn(header: string): { section: string; question: string } {
  const core = normalizeInspectionHeaderCore(header);
  const tokens = core.split("_").filter(Boolean);
  const toLabel = (value: string) => value.replace(/_/g, " ").replace(/\s+/g, " ").trim();

  const sectionToken = tokens[0] ?? "sem_secao";
  const questionToken = tokens.slice(1).join("_") || core || sectionToken;

  return {
    section: toLabel(sectionToken) || "Sem secao",
    question: toLabel(questionToken) || "(pergunta nao identificada)",
  };
}

function mapWideInspectionSemanticResult(outcome: QAOutcome, responseRaw: string): "real_failure" | "non_failure" | "na" | "undetermined" {
  return applySemanticRule(outcome, responseRaw);
}

function inferQuestionPolarity(question: string): SemanticQuestionPolarity {
  const q = question.toLowerCase();
  const negativeClues = [
    "vazamento",
    "odor",
    "praga",
    "risco",
    "dano",
    "contamin",
    "obstr",
    "defeito",
    "sujeira",
    "falha",
    "nao conforme",
    "não conforme",
    "incidente",
  ];
  const positiveClues = [
    "conforme",
    "limpo",
    "adequado",
    "organizado",
    "funcionando",
    "em ordem",
    "disponivel",
    "disponível",
    "seguro",
    "completo",
    "correto",
  ];

  if (negativeClues.some((clue) => q.includes(clue))) {
    return "negative";
  }
  if (positiveClues.some((clue) => q.includes(clue))) {
    return "positive";
  }
  if (q.includes("ausencia") || q.includes("ausência")) {
    return "negative";
  }
  if (q.includes("existe") || q.startsWith("ha ") || q.startsWith("há ")) {
    return "negative";
  }
  return "neutral";
}

function applySemanticRule(outcome: QAOutcome, responseRaw: string): "real_failure" | "non_failure" | "na" | "undetermined" {
  if (isMissing(responseRaw)) {
    return "na";
  }
  if (outcome === "na") {
    return "na";
  }
  if (outcome === "pass" || outcome === "yes") {
    return "non_failure";
  }
  if (outcome === "fail" || outcome === "no") {
    return "real_failure";
  }
  if (outcome === "unknown") {
    return "undetermined";
  }
  return "undetermined";
}

function resolveQuestionType(
  question: string,
  outcome: QAOutcome,
  config: ManualReviewConfig | undefined,
): SemanticQuestionPolarity {
  const byQuestion = config?.questionOverrides.find((entry) => entry.questionText === question);
  if (byQuestion && byQuestion.behavior !== "ignore") {
    return byQuestion.behavior;
  }
  return "neutral";
}

function questionIsIgnored(question: string, config: ManualReviewConfig | undefined): boolean {
  const override = config?.questionOverrides.find((entry) => entry.questionText === question);
  if (override?.behavior === "ignore") {
    return true;
  }
  return defaultIgnoredRegex.test(question);
}

function questionWeight(
  question: string,
  section: string | undefined,
  config: ManualReviewConfig | undefined,
): number {
  const qOverride = config?.questionOverrides.find((entry) => entry.questionText === question);
  if (qOverride?.weight !== undefined) {
    return qOverride.weight;
  }
  if (section) {
    const sOverride = config?.sectionWeights.find((entry) => entry.section === section);
    if (sOverride) {
      return sOverride.weight;
    }
  }
  return DEFAULT_WEIGHT;
}

function detectInspectionFields(
  dataset: NormalizedDataset,
  inference: DatasetTypeInference,
): { questionCol?: string; answerCol?: string; sectionCol?: string; dateCol?: string; unitCol?: string } {
  const lowerHeaders = dataset.headers.map((h) => ({ raw: h, lower: h.toLowerCase() }));

  const pickByKeyword = (keys: string[]): string | undefined => {
    for (const header of lowerHeaders) {
      if (keys.some((k) => header.lower.includes(k))) {
        return header.raw;
      }
    }
    return undefined;
  };

  const questionCol =
    pickByKeyword(["question", "pergunta", "item", "checkpoint", "criteria", "critério", "criterio"]) ??
    dataset.headers[0];
  const answerCol =
    pickByKeyword(["answer", "resposta", "result", "resultado", "status", "response", "outcome"]) ??
    dataset.headers[1];
  const sectionCol = pickByKeyword(["section", "seção", "secao", "categoria", "category", "topic", "area"]);
  const dateCol = pickByKeyword(["date", "data", "inspection date", "timestamp", "created at"]);
  const unitCol = pickByKeyword(["site", "location", "unidade", "store", "branch", "local"]);

  if (inference.datasetType !== "inspection_checklist" && inference.datasetType !== "survey_satisfaction") {
    return { questionCol, answerCol, sectionCol, dateCol, unitCol };
  }
  return { questionCol, answerCol, sectionCol, dateCol, unitCol };
}

function buildInspectionItems(
  dataset: NormalizedDataset,
  inference: DatasetTypeInference,
  config: ManualReviewConfig | undefined,
): { items: QAItem[]; stats: Record<string, number> } {
  const { questionCol, answerCol, sectionCol, dateCol } = detectInspectionFields(dataset, inference);
  const inspectionColumns = dataset.headers.filter(isInspectionQuestionColumn);
  const items: QAItem[] = [];
  let ignoredCount = 0;

  if (inspectionColumns.length > 0) {
    for (const row of dataset.rows) {
      for (const column of inspectionColumns) {
        const { section, question } = deriveSectionAndQuestionFromInspectionColumn(column);
        if (questionIsIgnored(question, config)) {
          ignoredCount += 1;
          continue;
        }
        const responseRaw = toStringValue(row[column]).trim();
        const outcome = parseAsOutcome(responseRaw);
        const semantics = mapWideInspectionSemanticResult(outcome, responseRaw);
        const criticalOverride = config?.questionOverrides.find((q) => q.questionText === question)?.critical ?? false;
        const weight = questionWeight(question, section || undefined, config);

        items.push({
          question,
          responseRaw,
          normalizedOutcome: outcome,
          section,
          date: dateCol ? toStringValue(row[dateCol]) : undefined,
          semanticPolarity: "neutral",
          semanticResult: semantics,
          critical: criticalOverride,
          weight,
          sourceRow: row,
        });
      }
    }
    return {
      items,
      stats: {
        ignoredCount,
      },
    };
  }

  for (const row of dataset.rows) {
    const question = toStringValue(questionCol ? row[questionCol] : "").trim();
    const responseRaw = toStringValue(answerCol ? row[answerCol] : "").trim();
    if (!question && !responseRaw) {
      continue;
    }
    if (question && questionIsIgnored(question, config)) {
      ignoredCount += 1;
      continue;
    }

    const outcome = parseAsOutcome(responseRaw);
    const semantics = applySemanticRule(outcome, responseRaw);
    const section = sectionCol ? toStringValue(row[sectionCol]).trim() : "";
    const criticalOverride = config?.questionOverrides.find((q) => q.questionText === question)?.critical ?? false;
    const weight = questionWeight(question, section || undefined, config);

    items.push({
      question: question || "(pergunta nao identificada)",
      responseRaw,
      normalizedOutcome: outcome,
      section: section || undefined,
      date: dateCol ? toStringValue(row[dateCol]) : undefined,
      semanticPolarity: "neutral",
      semanticResult: semantics,
      critical: criticalOverride,
      weight,
      sourceRow: row,
    });
  }

  return {
    items,
    stats: {
      ignoredCount,
    },
  };
}

function numericProfiles(dataset: NormalizedDataset, columnTypes: Record<string, ColumnType>) {
  const profiles: Array<{
    column: string;
    mean: number;
    med: number;
    min: number;
    max: number;
    range: number;
    count: number;
  }> = [];

  for (const header of dataset.headers) {
    if (columnTypes[header] !== "number") {
      continue;
    }
    const values = dataset.rows
      .map((row) => safeNumber(row[header]))
      .filter((value): value is number => value !== null && Number.isFinite(value));
    if (values.length === 0) {
      continue;
    }
    const min = Math.min(...values);
    const max = Math.max(...values);
    profiles.push({
      column: header,
      mean: average(values),
      med: median(values),
      min,
      max,
      range: max - min,
      count: values.length,
    });
  }
  return profiles;
}

function topCategoricalColumns(
  dataset: NormalizedDataset,
  columnTypes: Record<string, ColumnType>,
): Array<{ column: string; distinct: number; topValue?: string; topCount: number }> {
  const result: Array<{ column: string; distinct: number; topValue?: string; topCount: number }> = [];
  for (const header of dataset.headers) {
    if (columnTypes[header] !== "string" && columnTypes[header] !== "boolean") {
      continue;
    }
    const values = dataset.rows
      .map((row) => toStringValue(row[header]).trim())
      .filter((value) => value.length > 0);
    if (values.length === 0) {
      continue;
    }
    const freq = countBy(values);
    const sorted = [...freq.entries()].sort((a, b) => b[1] - a[1]);
    const [topValue, topCount] = sorted[0] ?? ["", 0];
    result.push({
      column: header,
      distinct: freq.size,
      topValue,
      topCount,
    });
  }
  return result.sort((a, b) => a.distinct - b.distinct).slice(0, 8);
}

function firstDateColumn(dataset: NormalizedDataset, columnTypes: Record<string, ColumnType>): string | undefined {
  return dataset.headers.find((header) => columnTypes[header] === "date");
}

type DashboardReliability = "low" | "medium" | "high";

type DashboardSelectionContext = {
  rowCount: number;
  structuralScore: number;
  missingRatio: number;
  inferenceConfidence: number;
  datasetType: DatasetType;
};

type DashboardSelectionMeta = {
  attempted: number;
  rendered: number;
  reliability: DashboardReliability;
  maxWidgets: number;
};

function calculateMissingRatio(dataset: NormalizedDataset): number {
  if (dataset.rows.length === 0 || dataset.headers.length === 0) {
    return 1;
  }
  const missingCount = dataset.rows.reduce((sum, row) => {
    return sum + dataset.headers.reduce((acc, header) => acc + (isMissing(row[header]) ? 1 : 0), 0);
  }, 0);
  const totalCells = dataset.rows.length * dataset.headers.length;
  return totalCells > 0 ? missingCount / totalCells : 1;
}

function bucketNumericByMonth(
  rows: NormalizedDataset["rows"],
  dateColumn: string,
  valueColumn: string,
): Array<[string, number]> {
  const grouped = new Map<string, number>();
  for (const row of rows) {
    const isoDate = toDate(row[dateColumn]);
    const numeric = safeNumber(row[valueColumn]);
    if (!isoDate || numeric === null) {
      continue;
    }
    const date = new Date(isoDate);
    const key = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
    grouped.set(key, (grouped.get(key) ?? 0) + numeric);
  }
  return [...grouped.entries()].sort(([a], [b]) => (a > b ? 1 : -1));
}

function groupByCount(dataset: NormalizedDataset, categoryColumn: string): Map<string, number> {
  return countBy(
    dataset.rows
      .map((row) => toStringValue(row[categoryColumn]).trim())
      .filter((value) => value.length > 0),
  );
}

function groupBySum(
  dataset: NormalizedDataset,
  categoryColumn: string,
  numericColumn: string,
): Map<string, number> {
  const grouped = new Map<string, number>();
  for (const row of dataset.rows) {
    const category = toStringValue(row[categoryColumn]).trim() || "Nao informado";
    const numeric = safeNumber(row[numericColumn]);
    if (numeric === null) {
      continue;
    }
    grouped.set(category, (grouped.get(category) ?? 0) + numeric);
  }
  return grouped;
}

function findNumericColumnByPattern(
  dataset: NormalizedDataset,
  columnTypes: Record<string, ColumnType>,
  pattern: RegExp,
): string | undefined {
  return dataset.headers.find((header) => columnTypes[header] === "number" && pattern.test(header.toLowerCase()));
}

function firstNumericColumn(
  dataset: NormalizedDataset,
  columnTypes: Record<string, ColumnType>,
): string | undefined {
  return dataset.headers.find((header) => columnTypes[header] === "number");
}

function firstStringColumnByPattern(
  dataset: NormalizedDataset,
  columnTypes: Record<string, ColumnType>,
  pattern: RegExp,
): string | undefined {
  return dataset.headers.find(
    (header) =>
      (columnTypes[header] === "string" || columnTypes[header] === "mixed") &&
      pattern.test(header.toLowerCase()),
  );
}

function selectDashboardReliability(context: DashboardSelectionContext): DashboardReliability {
  if (
    context.rowCount < 10 ||
    context.structuralScore < 0.45 ||
    context.missingRatio > 0.55 ||
    context.inferenceConfidence < 0.35
  ) {
    return "low";
  }
  if (
    context.rowCount < 30 ||
    context.structuralScore < 0.72 ||
    context.missingRatio > 0.35 ||
    context.inferenceConfidence < 0.6
  ) {
    return "medium";
  }
  return "high";
}

function isWidgetInformative(widget: DashboardWidget): boolean {
  if (widget.widgetType === "table") {
    return widget.data.length >= 2;
  }
  if (widget.widgetType === "line") {
    return widget.data.length >= 3;
  }
  return widget.data.length >= 2;
}

function selectDashboardWidgets(
  candidates: DashboardWidget[],
  context: DashboardSelectionContext,
): { widgets: DashboardWidget[]; meta: DashboardSelectionMeta } {
  const deduped = candidates.filter(
    (widget, index, allWidgets) => allWidgets.findIndex((candidate) => candidate.id === widget.id) === index,
  );
  const informativeWidgets = deduped.filter(isWidgetInformative);
  const reliability = selectDashboardReliability(context);
  const baseMax =
    reliability === "high"
      ? MAX_WIDGETS_HIGH_RELIABILITY
      : reliability === "medium"
        ? MAX_WIDGETS_MEDIUM_RELIABILITY
        : MAX_WIDGETS_LOW_RELIABILITY;
  const maxWidgets = context.datasetType === "generic" ? Math.min(baseMax, 3) : baseMax;
  const widgets = informativeWidgets.slice(0, maxWidgets);
  return {
    widgets,
    meta: {
      attempted: informativeWidgets.length,
      rendered: widgets.length,
      reliability,
      maxWidgets,
    },
  };
}

function createSummaryCards(
  dataset: NormalizedDataset,
  inference: DatasetTypeInference,
  structure: ReturnType<typeof structuralQuality>,
  qaItems: QAItem[],
  sourceScoreSummary?: SourceScoreSummary,
): SummaryCard[] {
  const formatPct = (value: number) => (Number.isInteger(value) ? `${value}%` : `${value.toFixed(1)}%`);
  const cards: SummaryCard[] = [
    { label: "Linhas", value: dataset.rows.length.toLocaleString("pt-BR") },
    { label: "Colunas", value: dataset.headers.length.toLocaleString("pt-BR") },
    {
      label: "Tipo inferido",
      value: `${inference.datasetType} (${Math.round(confidenceFromScore(inference.confidence) * 100)}%)`,
    },
    {
      label: "Qualidade estrutural",
      value: `${structure.label} (${Math.round(structure.score * 100)}%)`,
      emphasis: structure.score < 0.5 ? "warning" : "success",
    },
  ];

  if (sourceScoreSummary) {
    cards.unshift({
      label: "Conformidade",
      value: formatPct(sourceScoreSummary.compliancePercentage),
      emphasis: sourceScoreSummary.isMaxScore ? "success" : "default",
    });
  }
  if (qaItems.length > 0) {
    const failures = qaItems.filter((item) => item.semanticResult === "real_failure").length;
    const na = qaItems.filter((item) => item.semanticResult === "na").length;
    const evaluatedAnswers = failures + qaItems.filter((item) => item.semanticResult === "non_failure").length;
    const calculatedIcs = clamp((1 - failures / Math.max(evaluatedAnswers, 1)) * 100, 0, 100);
    cards.push({
      label: "Falhas reais",
      value: `${failures} (${qaItems.length > 0 ? Math.round((failures / qaItems.length) * 100) : 0}%)`,
      emphasis: failures / Math.max(qaItems.length, 1) > 0.2 ? "danger" : "default",
    });
    cards.push({
      label: "ICS calculado",
      value: `${calculatedIcs.toFixed(1)}%`,
      emphasis: calculatedIcs < 70 ? "warning" : "success",
    });
    cards.push({
      label: "Nao aplicavel",
      value: `${na}`,
      emphasis: na / Math.max(qaItems.length, 1) > 0.3 ? "warning" : "default",
    });
  }

  return cards;
}

function createInspectionWidgets(qaItems: QAItem[], weightedIssues: WeightedIssue[]): DashboardWidget[] {
  const widgets: DashboardWidget[] = [];
  const total = qaItems.length;
  const failures = qaItems.filter((i) => i.semanticResult === "real_failure").length;
  const nonFailures = qaItems.filter((i) => i.semanticResult === "non_failure").length;
  const na = qaItems.filter((i) => i.semanticResult === "na").length;
  const und = qaItems.filter((i) => i.semanticResult === "undetermined").length;

  if (total > 0) {
    widgets.push({
      id: "inspection-outcome-breakdown",
      title: "Distribuicao de resultado interpretado",
      description: "Classificacao semantica entre falha real, conformidade, NA e indeterminado.",
      widgetType: "bar",
      data: [
        { label: "Falha real", value: failures },
        { label: "Conforme", value: nonFailures },
        { label: "Nao aplicavel", value: na },
        { label: "Indeterminado", value: und },
      ],
      config: { xKey: "label", yKey: "value" },
    });
  }

  const bySection = countBy(
    qaItems
      .filter((item) => item.semanticResult === "real_failure")
      .map((item) => item.section || "Sem secao"),
  );
  if (bySection.size > 0) {
    widgets.push({
      id: "inspection-sections-failures",
      title: "Falhas por secao",
      description: "Sinaliza areas mais problematicas.",
      widgetType: "bar",
      data: topN(bySection, 10).map(([section, count]) => ({ section, count })),
      config: { xKey: "section", yKey: "count" },
    });
  }

  const byQuestion = countBy(
    qaItems
      .filter((item) => item.semanticResult === "real_failure")
      .map((item) => item.question),
  );
  if (byQuestion.size > 0) {
    widgets.push({
      id: "inspection-questions-failures",
      title: "Perguntas com mais falhas",
      description: "Ranking de itens com maior recorrencia de nao conformidade real.",
      widgetType: "bar",
      data: topN(byQuestion, 12).map(([question, count]) => ({ question, count })),
      config: { xKey: "question", yKey: "count" },
    });
  }

  if (weightedIssues.length > 0) {
    widgets.push({
      id: "inspection-weighted-risk",
      title: "Risco ponderado por pergunta",
      description: "Mostra impacto considerando criticidade/peso configurado.",
      widgetType: "bar",
      data: weightedIssues.slice(0, 10).map((issue) => ({
        question: issue.question,
        score: Number(issue.weightedScore.toFixed(2)),
      })),
      config: { xKey: "question", yKey: "score" },
    });
  }

  if (total > 0 && failures + nonFailures > 0) {
    widgets.push({
      id: "inspection-rate-donut",
      title: "Taxa de falha e conformidade",
      description: "Visao executiva para leitura rapida.",
      widgetType: "pie",
      data: [
        { label: "Falha real", value: failures },
        { label: "Conforme", value: nonFailures },
      ],
      config: { nameKey: "label", valueKey: "value" },
    });
  }
  return widgets;
}

function createSalesFinanceWidgets(
  dataset: NormalizedDataset,
  columnTypes: Record<string, ColumnType>,
  datasetType: "sales" | "finance",
): DashboardWidget[] {
  const widgets: DashboardWidget[] = [];
  const numeric = numericProfiles(dataset, columnTypes);
  const categorical = topCategoricalColumns(dataset, columnTypes);
  const dateCol = firstDateColumn(dataset, columnTypes);
  const moneyColumn =
    findNumericColumnByPattern(
      dataset,
      columnTypes,
      /(fatur|receita|valor|total|price|amount|custo|expense|despesa|revenue|sales)/i,
    ) ?? firstNumericColumn(dataset, columnTypes);
  const groupColumn =
    categorical.find((entry) => entry.column !== moneyColumn && entry.distinct >= 2 && entry.distinct <= 25)?.column ??
    categorical[0]?.column;

  if (dateCol && moneyColumn) {
    const monthlyTotals = bucketNumericByMonth(dataset.rows, dateCol, moneyColumn);
    if (monthlyTotals.length > 1) {
      widgets.push({
        id: `${datasetType}-monthly-value-trend`,
        title: "Evolucao temporal do valor total",
        description: "Tendencia mensal somando o principal valor monetario.",
        widgetType: "line",
        data: monthlyTotals.map(([period, value]) => ({ period, value: Number(value.toFixed(2)) })),
        config: { xKey: "period", yKey: "value" },
      });
    }
  }

  if (groupColumn && moneyColumn) {
    const groupedValues = groupBySum(dataset, groupColumn, moneyColumn);
    if (groupedValues.size > 1) {
      widgets.push({
        id: `${datasetType}-group-ranking-by-value`,
        title: `Ranking por ${normalizeHeader(groupColumn)}`,
        description:
          datasetType === "sales"
            ? "Prioriza os grupos com maior faturamento."
            : "Prioriza os grupos com maior concentracao de valor financeiro.",
        widgetType: "bar",
        data: topN(groupedValues, MAX_CATEGORY_FOR_BAR).map(([group, value]) => ({
          group,
          value: Number(value.toFixed(2)),
        })),
        config: { xKey: "group", yKey: "value" },
      });
    }
  }

  if (groupColumn) {
    const groupedCount = groupByCount(dataset, groupColumn);
    if (groupedCount.size > 1) {
      widgets.push({
        id: `${datasetType}-group-volume`,
        title: "Volume de registros por grupo",
        description: "Mostra concentracao operacional por categoria principal.",
        widgetType: "bar",
        data: topN(groupedCount, MAX_CATEGORY_FOR_BAR).map(([group, count]) => ({ group, count })),
        config: { xKey: "group", yKey: "count" },
      });
    }
  }

  if (moneyColumn) {
    const profile = numeric.find((entry) => entry.column === moneyColumn);
    if (profile) {
      widgets.push({
        id: `${datasetType}-value-summary`,
        title: `Resumo numerico: ${normalizeHeader(moneyColumn)}`,
        description: "Resumo estatistico para apoiar decisao executiva.",
        widgetType: "table",
        data: [
          { metrica: "Media", valor: Number(profile.mean.toFixed(2)) },
          { metrica: "Mediana", valor: Number(profile.med.toFixed(2)) },
          { metrica: "Minimo", valor: Number(profile.min.toFixed(2)) },
          { metrica: "Maximo", valor: Number(profile.max.toFixed(2)) },
          { metrica: "Amplitude", valor: Number(profile.range.toFixed(2)) },
        ],
        config: { columns: ["metrica", "valor"] },
      });
    }
  }

  return widgets;
}

function createInventoryWidgets(
  dataset: NormalizedDataset,
  columnTypes: Record<string, ColumnType>,
): DashboardWidget[] {
  const widgets: DashboardWidget[] = [];
  const categorical = topCategoricalColumns(dataset, columnTypes);
  const quantityColumn =
    findNumericColumnByPattern(dataset, columnTypes, /(qtd|quant|quantity|estoque|stock|saldo|inventory)/i) ??
    firstNumericColumn(dataset, columnTypes);
  const categoryColumn =
    categorical.find((entry) =>
      /(categoria|category|tipo|type|grupo|familia|family|secao|seção)/i.test(entry.column.toLowerCase()),
    )?.column ?? categorical[0]?.column;
  const itemColumn =
    firstStringColumnByPattern(
      dataset,
      columnTypes,
      /(produto|product|item|sku|material|codigo|c[oó]digo|descricao|descri[cç][aã]o|nome)/i,
    ) ?? categoryColumn;
  const dateCol = firstDateColumn(dataset, columnTypes);

  if (categoryColumn) {
    const groupedCount = groupByCount(dataset, categoryColumn);
    if (groupedCount.size > 1) {
      widgets.push({
        id: "inventory-category-volume",
        title: "Itens por categoria",
        description: "Ranking das categorias com maior volume de itens.",
        widgetType: "bar",
        data: topN(groupedCount, MAX_CATEGORY_FOR_BAR).map(([category, count]) => ({ category, count })),
        config: { xKey: "category", yKey: "count" },
      });
    }
  }

  if (categoryColumn && quantityColumn) {
    const groupedStock = groupBySum(dataset, categoryColumn, quantityColumn);
    if (groupedStock.size > 1) {
      widgets.push({
        id: "inventory-stock-by-category",
        title: "Estoque total por categoria",
        description: "Soma de quantidade para identificar concentracao de estoque.",
        widgetType: "bar",
        data: topN(groupedStock, MAX_CATEGORY_FOR_BAR).map(([category, quantity]) => ({
          category,
          quantity: Number(quantity.toFixed(2)),
        })),
        config: { xKey: "category", yKey: "quantity" },
      });
    }
  }

  if (itemColumn && quantityColumn) {
    const lowStockRows = dataset.rows
      .map((row) => ({
        item: toStringValue(row[itemColumn]).trim() || "Nao informado",
        quantity: safeNumber(row[quantityColumn]),
      }))
      .filter(
        (entry): entry is { item: string; quantity: number } =>
          entry.item.length > 0 && entry.quantity !== null && Number.isFinite(entry.quantity),
      )
      .sort((a, b) => a.quantity - b.quantity)
      .slice(0, 10);
    if (lowStockRows.length >= 3) {
      widgets.push({
        id: "inventory-low-stock",
        title: "Itens com menor quantidade",
        description: "Prioriza itens com menor saldo para acao de reposicao.",
        widgetType: "table",
        data: lowStockRows.map((entry) => ({
          item: entry.item,
          quantidade: Number(entry.quantity.toFixed(2)),
        })),
        config: { columns: ["item", "quantidade"] },
      });
    }
  }

  if (dateCol && quantityColumn) {
    const monthlyMovement = bucketNumericByMonth(dataset.rows, dateCol, quantityColumn);
    if (monthlyMovement.length > 1) {
      widgets.push({
        id: "inventory-monthly-movement",
        title: "Movimento mensal de estoque",
        description: "Evolucao mensal da coluna principal de quantidade.",
        widgetType: "line",
        data: monthlyMovement.map(([period, quantity]) => ({
          period,
          quantity: Number(quantity.toFixed(2)),
        })),
        config: { xKey: "period", yKey: "quantity" },
      });
    }
  }

  return widgets;
}

function createSurveyWidgets(
  dataset: NormalizedDataset,
  columnTypes: Record<string, ColumnType>,
): DashboardWidget[] {
  const widgets: DashboardWidget[] = [];
  const ratingColumn =
    findNumericColumnByPattern(
      dataset,
      columnTypes,
      /(nota|rating|score|satisf|nps|avaliac|avalia[cç][aã]o|pontua[cç][aã]o)/i,
    ) ?? firstNumericColumn(dataset, columnTypes);
  const questionColumn =
    firstStringColumnByPattern(dataset, columnTypes, /(pergunta|question|item|tema|topico|t[oó]pico|criterio|crit[eé]rio)/i) ??
    firstStringColumnByPattern(dataset, columnTypes, /(categoria|category|aspecto|dimens[aã]o)/i);
  const dateCol = firstDateColumn(dataset, columnTypes);

  if (ratingColumn) {
    const distribution = new Map<string, number>();
    for (const row of dataset.rows) {
      const value = safeNumber(row[ratingColumn]);
      if (value === null) {
        continue;
      }
      const bucket = String(Math.round(value));
      distribution.set(bucket, (distribution.get(bucket) ?? 0) + 1);
    }
    if (distribution.size > 1) {
      widgets.push({
        id: "survey-rating-distribution",
        title: `Distribuicao de ${normalizeHeader(ratingColumn)}`,
        description: "Mostra concentracao das notas atribuídas.",
        widgetType: "bar",
        data: [...distribution.entries()]
          .sort(([a], [b]) => Number(a) - Number(b))
          .map(([rating, count]) => ({ rating, count })),
        config: { xKey: "rating", yKey: "count" },
      });
    }
  }

  if (questionColumn && ratingColumn) {
    const grouped = new Map<string, { sum: number; count: number }>();
    for (const row of dataset.rows) {
      const question = toStringValue(row[questionColumn]).trim();
      const value = safeNumber(row[ratingColumn]);
      if (!question || value === null) {
        continue;
      }
      const current = grouped.get(question) ?? { sum: 0, count: 0 };
      current.sum += value;
      current.count += 1;
      grouped.set(question, current);
    }
    const lowAverage = [...grouped.entries()]
      .map(([question, stats]) => ({
        question,
        averageScore: stats.count > 0 ? stats.sum / stats.count : 0,
      }))
      .sort((a, b) => a.averageScore - b.averageScore)
      .slice(0, 10);
    if (lowAverage.length >= 2) {
      widgets.push({
        id: "survey-lowest-average-questions",
        title: "Perguntas com pior media",
        description: "Destaca temas com desempenho mais baixo.",
        widgetType: "bar",
        data: lowAverage.map((entry) => ({
          question: entry.question,
          averageScore: Number(entry.averageScore.toFixed(2)),
        })),
        config: { xKey: "question", yKey: "averageScore" },
      });
    }
  }

  if (dateCol && ratingColumn) {
    const monthly = new Map<string, { sum: number; count: number }>();
    for (const row of dataset.rows) {
      const isoDate = toDate(row[dateCol]);
      const rating = safeNumber(row[ratingColumn]);
      if (!isoDate || rating === null) {
        continue;
      }
      const date = new Date(isoDate);
      const key = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
      const current = monthly.get(key) ?? { sum: 0, count: 0 };
      current.sum += rating;
      current.count += 1;
      monthly.set(key, current);
    }
    const series = [...monthly.entries()]
      .sort(([a], [b]) => (a > b ? 1 : -1))
      .map(([period, stats]) => ({
        period,
        averageScore: stats.count > 0 ? Number((stats.sum / stats.count).toFixed(2)) : 0,
      }));
    if (series.length > 1) {
      widgets.push({
        id: "survey-monthly-score-trend",
        title: "Evolucao temporal da satisfacao",
        description: "Tendencia mensal da media de notas.",
        widgetType: "line",
        data: series,
        config: { xKey: "period", yKey: "averageScore" },
      });
    }
  }

  if (ratingColumn) {
    const profile = numericProfiles(dataset, columnTypes).find((entry) => entry.column === ratingColumn);
    if (profile) {
      widgets.push({
        id: "survey-score-summary",
        title: `Resumo numerico: ${normalizeHeader(ratingColumn)}`,
        description: "Estatisticas principais para leitura rapida.",
        widgetType: "table",
        data: [
          { metrica: "Media", valor: Number(profile.mean.toFixed(2)) },
          { metrica: "Mediana", valor: Number(profile.med.toFixed(2)) },
          { metrica: "Minimo", valor: Number(profile.min.toFixed(2)) },
          { metrica: "Maximo", valor: Number(profile.max.toFixed(2)) },
        ],
        config: { columns: ["metrica", "valor"] },
      });
    }
  }

  return widgets;
}

function createOperationsWidgets(
  dataset: NormalizedDataset,
  columnTypes: Record<string, ColumnType>,
): DashboardWidget[] {
  const widgets: DashboardWidget[] = [];
  const numeric = numericProfiles(dataset, columnTypes);
  const dateCol = firstDateColumn(dataset, columnTypes);
  const categorical = topCategoricalColumns(dataset, columnTypes);

  if (dateCol) {
    const buckets = bucketByMonth(dataset.rows, dateCol);
    if (buckets.length > 1) {
      widgets.push({
        id: "time-trend",
        title: "Evolucao temporal (registros por periodo)",
        description: "Tendencia basica de volume ao longo do tempo.",
        widgetType: "line",
        data: buckets.map(([period, count]) => ({ period, count })),
        config: { xKey: "period", yKey: "count" },
      });
    }
  }

  const operationalCategory =
    categorical.find((entry) =>
      /(status|estado|situac|situa[cç][aã]o|resultado|categoria|category|tipo|type|time|equipe|team|turno|shift)/i.test(
        entry.column.toLowerCase(),
      ),
    )?.column ?? categorical[0]?.column;
  if (operationalCategory) {
    const counts = groupByCount(dataset, operationalCategory);
    if (counts.size > 1) {
      widgets.push({
        id: "operations-category-ranking",
        title: `Ranking por ${normalizeHeader(operationalCategory)}`,
        description: "Mostra onde existe maior concentracao operacional.",
        widgetType: "bar",
        data: topN(counts, MAX_CATEGORY_FOR_BAR).map(([category, count]) => ({ category, count })),
        config: { xKey: "category", yKey: "count" },
      });
    }
  }

  const metricColumn =
    findNumericColumnByPattern(dataset, columnTypes, /(tempo|time|durac|dura[cç][aã]o|produt|output|volume|qtd|quant|sla|atraso|delay|custo|cost)/i) ??
    numeric[0]?.column;
  if (metricColumn && operationalCategory) {
    const groupedMetric = groupBySum(dataset, operationalCategory, metricColumn);
    if (groupedMetric.size > 1) {
      widgets.push({
        id: "operations-metric-by-category",
        title: `Metrica total por ${normalizeHeader(operationalCategory)}`,
        description: "Compara impacto total por grupo operacional.",
        widgetType: "bar",
        data: topN(groupedMetric, MAX_CATEGORY_FOR_BAR).map(([category, value]) => ({
          category,
          value: Number(value.toFixed(2)),
        })),
        config: { xKey: "category", yKey: "value" },
      });
    }
  }

  const bestNumeric = numeric[0];
  if (bestNumeric) {
    widgets.push({
      id: "operations-numeric-summary",
      title: `Perfil numerico: ${normalizeHeader(bestNumeric.column)}`,
      description: "Resumo de tendencia central e variabilidade.",
      widgetType: "table",
      data: [
        { metrica: "Media", valor: Number(bestNumeric.mean.toFixed(2)) },
        { metrica: "Mediana", valor: Number(bestNumeric.med.toFixed(2)) },
        { metrica: "Minimo", valor: Number(bestNumeric.min.toFixed(2)) },
        { metrica: "Maximo", valor: Number(bestNumeric.max.toFixed(2)) },
        { metrica: "Amplitude", valor: Number(bestNumeric.range.toFixed(2)) },
      ],
      config: { columns: ["metrica", "valor"] },
    });
  }

  return widgets;
}

function createAdaptiveWidgets(
  dataset: NormalizedDataset,
  columnTypes: Record<string, ColumnType>,
): DashboardWidget[] {
  const widgets: DashboardWidget[] = [];
  const dateCol = firstDateColumn(dataset, columnTypes);
  const categorical = topCategoricalColumns(dataset, columnTypes);
  const numeric = numericProfiles(dataset, columnTypes);

  if (dateCol) {
    const buckets = bucketByMonth(dataset.rows, dateCol);
    if (buckets.length > 1) {
      widgets.push({
        id: "generic-time-trend",
        title: "Evolucao temporal de registros",
        description: "Volume de registros por periodo para leitura de tendencia.",
        widgetType: "line",
        data: buckets.map(([period, count]) => ({ period, count })),
        config: { xKey: "period", yKey: "count" },
      });
    }
  }

  const primaryCategory = categorical.find((entry) => entry.distinct >= 2 && entry.distinct <= 25)?.column;
  if (primaryCategory) {
    const counts = groupByCount(dataset, primaryCategory);
    if (counts.size > 1) {
      widgets.push({
        id: "generic-category-ranking",
        title: `Distribuicao por ${normalizeHeader(primaryCategory)}`,
        description: "Ranking das categorias dominantes do dataset.",
        widgetType: "bar",
        data: topN(counts, MAX_CATEGORY_FOR_BAR).map(([category, count]) => ({ category, count })),
        config: { xKey: "category", yKey: "count" },
      });
    }
  }

  const primaryNumeric = numeric[0]?.column;
  if (primaryCategory && primaryNumeric) {
    const grouped = groupBySum(dataset, primaryCategory, primaryNumeric);
    if (grouped.size > 1) {
      widgets.push({
        id: "generic-numeric-by-category",
        title: `${normalizeHeader(primaryNumeric)} por categoria`,
        description: "Comparacao do principal valor numerico por categoria.",
        widgetType: "bar",
        data: topN(grouped, MAX_CATEGORY_FOR_BAR).map(([category, value]) => ({
          category,
          value: Number(value.toFixed(2)),
        })),
        config: { xKey: "category", yKey: "value" },
      });
    }
  }

  const bestNumeric = numeric[0];
  if (bestNumeric) {
    widgets.push({
      id: "generic-numeric-summary",
      title: `Resumo numerico: ${normalizeHeader(bestNumeric.column)}`,
      description: "Estatisticas basicas para coluna numerica principal.",
      widgetType: "table",
      data: [
        { metrica: "Media", valor: Number(bestNumeric.mean.toFixed(2)) },
        { metrica: "Mediana", valor: Number(bestNumeric.med.toFixed(2)) },
        { metrica: "Minimo", valor: Number(bestNumeric.min.toFixed(2)) },
        { metrica: "Maximo", valor: Number(bestNumeric.max.toFixed(2)) },
      ],
      config: { columns: ["metrica", "valor"] },
    });
  }

  return widgets;
}

function createDatasetWidgets(
  dataset: NormalizedDataset,
  columnTypes: Record<string, ColumnType>,
  datasetType: DatasetType,
): DashboardWidget[] {
  if (datasetType === "sales" || datasetType === "finance") {
    return createSalesFinanceWidgets(dataset, columnTypes, datasetType);
  }
  if (datasetType === "inventory") {
    return createInventoryWidgets(dataset, columnTypes);
  }
  if (datasetType === "survey_satisfaction") {
    return createSurveyWidgets(dataset, columnTypes);
  }
  if (datasetType === "productivity" || datasetType === "operations_maintenance") {
    return createOperationsWidgets(dataset, columnTypes);
  }
  return createAdaptiveWidgets(dataset, columnTypes);
}

function createDataPreview(dataset: NormalizedDataset, limit = 12): Record<string, unknown>[] {
  return dataset.rows.slice(0, limit).map((row) => {
    const obj: Record<string, unknown> = {};
    for (const header of dataset.headers) {
      obj[header] = row[header];
    }
    return obj;
  });
}

function findSourceScoreColumns(dataset: NormalizedDataset): { scoreColumn?: string; totalScoreColumn?: string } {
  const byKeyword = (pattern: RegExp, excludes?: RegExp) =>
    dataset.headers.find((header) => {
      const normalized = header.toLowerCase();
      if (excludes?.test(normalized)) {
        return false;
      }
      return pattern.test(normalized);
    });

  const scoreColumn =
    byKeyword(/^(score|pontuacao|pontuação|nota)$/i, /(total|maximo|máximo|overall|geral|final)/i) ??
    byKeyword(/(^|[_\s-])(score|pontuacao|pontuação|nota)($|[_\s-])/i, /(total|maximo|máximo|overall|geral|final)/i);
  const totalScoreColumn =
    byKeyword(/^(totalscore|total_score|total score|pontuacao total|pontuação total|nota maxima|nota máxima)$/i) ??
    byKeyword(
      /(^|[_\s-])(total score|total_score|totalscore|max score|maximo|máximo|pontuacao total|pontuação total|nota maxima|nota máxima)($|[_\s-])/i,
      /^(score|pontuacao|pontuação|nota)$/i,
    );

  if (!scoreColumn || !totalScoreColumn || scoreColumn === totalScoreColumn) {
    return {};
  }
  return { scoreColumn, totalScoreColumn };
}

function buildSourceScoreSummary(dataset: NormalizedDataset): SourceScoreSummary | undefined {
  const { scoreColumn, totalScoreColumn } = findSourceScoreColumns(dataset);
  if (!scoreColumn || !totalScoreColumn || dataset.rows.length === 0) {
    return undefined;
  }

  const latestRow = dataset.rows[0];
  const score = safeNumber(latestRow[scoreColumn]);
  const totalScore = safeNumber(latestRow[totalScoreColumn]);
  if (score === null || totalScore === null || totalScore <= 0) {
    return undefined;
  }

  const compliancePercentage = clamp((score / totalScore) * 100, 0, 100);
  const isMaxScore = Math.abs(totalScore - score) < 0.0001;
  const explanation = isMaxScore
    ? `A pontuacao veio do arquivo de origem: ${score}/${totalScore}. Isso representa pontuacao maxima atingida e 100% de conformidade.`
    : `A pontuacao veio do arquivo de origem: ${score}/${totalScore}, equivalente a ${compliancePercentage.toFixed(
        1,
      )}% de conformidade.`;

  return {
    score,
    totalScore,
    compliancePercentage,
    scoreColumn,
    totalScoreColumn,
    isMaxScore,
    explanation,
  };
}
function calculateWeightedIssues(qaItems: QAItem[]): WeightedIssue[] {
  const byQuestion = new Map<
    string,
    {
      question: string;
      section?: string;
      failures: number;
      total: number;
      weight: number;
      critical: boolean;
    }
  >();

  for (const item of qaItems) {
    const key = item.question;
    const current = byQuestion.get(key) ?? {
      question: item.question,
      section: item.section,
      failures: 0,
      total: 0,
      weight: item.weight ?? DEFAULT_WEIGHT,
      critical: item.critical,
    };
    current.total += 1;
    if (item.semanticResult === "real_failure") {
      current.failures += 1;
    }
    current.weight = Math.max(current.weight, item.weight ?? DEFAULT_WEIGHT);
    current.critical = current.critical || item.critical;
    byQuestion.set(key, current);
  }

  return [...byQuestion.values()]
    .map((item) => {
      const failureRate = item.total > 0 ? item.failures / item.total : 0;
      const weightedScore = failureRate * item.weight * (item.critical ? 1.4 : 1);
      return {
        question: item.question,
        section: item.section,
        failures: item.failures,
        total: item.total,
        failureRate,
        weight: item.weight,
        critical: item.critical,
        weightedScore,
      };
    })
    .sort((a, b) => b.weightedScore - a.weightedScore);
}

function createInsights(
  dataset: NormalizedDataset,
  inference: DatasetTypeInference,
  structure: ReturnType<typeof structuralQuality>,
  columnTypes: Record<string, ColumnType>,
  qaItems: QAItem[],
  weightedIssues: WeightedIssue[],
  dashboardMeta: DashboardSelectionMeta,
): string[] {
  const insights: string[] = [];
  const confidence = Math.round(confidenceFromScore(inference.confidence) * 100);

  if (qaItems.length > 0) {
    const bySection = countBy(
      qaItems
        .filter((item) => item.semanticResult === "real_failure")
        .map((item) => item.section || "Sem seção"),
    );
    const topSection = topN(bySection, 1)[0];
    if (topSection) {
      insights.push(`As falhas estão concentradas em "${topSection[0]}", com ${topSection[1]} não conformidades.`);
    }

    const byGroup = collectGroupStats(qaItems, "loja");
    if (byGroup.length >= 2) {
      const sortedByIcs = [...byGroup].sort((a, b) => a.ics - b.ics);
      const worst = sortedByIcs[0];
      const best = sortedByIcs[sortedByIcs.length - 1];
      insights.push(
        `A unidade "${worst.group}" apresenta o menor nível de conformidade (${worst.ics.toFixed(1)}%), enquanto "${best.group}" lidera com ${best.ics.toFixed(1)}%.`,
      );
    }

    const criticalFailures = qaItems.filter((item) => item.semanticResult === "real_failure" && (item.critical || item.weight >= 4)).length;
    const failureRate =
      qaItems.filter((item) => item.semanticResult === "real_failure").length /
      Math.max(
        qaItems.filter((item) => item.semanticResult === "real_failure" || item.semanticResult === "non_failure")
          .length,
        1,
      );
    if (criticalFailures > 0 && failureRate < 0.2) {
      insights.push(
        `Apesar da conformidade geral relativamente alta, foram identificadas ${criticalFailures} falhas críticas que exigem ação imediata.`,
      );
    } else {
      insights.push(
        `A taxa de não conformidade está em ${(failureRate * 100).toFixed(1)}%, refletindo o comportamento sanitário consolidado das inspeções.`,
      );
    }

    const icsValues = collectGroupStats(qaItems, "setor").map((entry) => entry.ics);
    if (icsValues.length > 1) {
      const deviation = Math.sqrt(average(icsValues.map((value) => (value - average(icsValues)) ** 2)));
      insights.push(
        deviation < 8
          ? "A baixa variabilidade do ICS indica padrão sanitário consistente entre áreas avaliadas."
          : "A variabilidade elevada do ICS indica diferenças relevantes entre áreas e necessidade de padronização.",
      );
    }

    if (weightedIssues[0]) {
      insights.push(
        `A principal prioridade operacional é "${weightedIssues[0].question}", que combina recorrência e criticidade acima dos demais itens.`,
      );
    }
  } else {
    insights.push(
      `O dataset foi classificado como ${inference.datasetType} com confiança de ${confidence}%.`,
    );
    const categorical = topCategoricalColumns(dataset, columnTypes);
    if (categorical[0]) {
      const dominance = dataset.rows.length ? (categorical[0].topCount / dataset.rows.length) * 100 : 0;
      insights.push(
        `Há concentração relevante em "${categorical[0].column}", onde o principal grupo responde por ${dominance.toFixed(
          1,
        )}% dos registros.`,
      );
    }
    const numeric = numericProfiles(dataset, columnTypes);
    if (numeric[0]) {
      insights.push(
        `A métrica "${numeric[0].column}" apresenta média ${numeric[0].mean.toFixed(2)} e amplitude ${numeric[0].range.toFixed(
          2,
        )}, indicando ${numeric[0].range > numeric[0].mean * 2 ? "alta oscilação" : "comportamento estável"}.`,
      );
    }
  }

  const missingRatio = calculateMissingRatio(dataset);
  if (structure.score < 0.6 || missingRatio > 0.3) {
    insights.push(
      `A qualidade estrutural foi classificada como ${structure.label}; recomenda-se cautela porque ${Math.round(
        missingRatio * 100,
      )}% dos campos estão vazios.`,
    );
  }

  if (dashboardMeta.rendered === 0) {
    insights.push("Os dashboards foram reduzidos ao essencial por falta de base confiável para comparações executivas.");
  } else if (dashboardMeta.rendered < dashboardMeta.attempted) {
    insights.push(
      `Foram exibidos apenas ${dashboardMeta.rendered} dashboards de maior valor para evitar visualizações pouco acionáveis.`,
    );
  }

  while (insights.length < 5) {
    insights.push(
      "A análise priorizou conclusões objetivas e acionáveis para apoiar decisões operacionais sanitárias.",
    );
  }

  return insights;
}

function createAlerts(
  dataset: NormalizedDataset,
  inference: DatasetTypeInference,
  structure: ReturnType<typeof structuralQuality>,
  qaItems: QAItem[],
  weightedIssues: WeightedIssue[],
  dashboardMeta: DashboardSelectionMeta,
): string[] {
  const alerts: string[] = [];
  if (structure.score < 0.5) {
    alerts.push("Qualidade estrutural baixa: arquivo apresenta lacunas ou padrao inconsistente.");
  }
  if (inference.confidence < 0.55) {
    alerts.push("Classificacao do dataset com confianca limitada; revise regras antes de decidir.");
  }
  if (dataset.headers.length < 3) {
    alerts.push("Poucas colunas identificadas: dashboards podem ficar limitados.");
  }
  if (dataset.rows.length < 20) {
    alerts.push("Base pequena para inferencias robustas; resultados devem ser lidos com cautela.");
  }
  if (qaItems.length > 0) {
    const undetermined = qaItems.filter((item) => item.semanticResult === "undetermined").length;
    const naCount = qaItems.filter((item) => item.semanticResult === "na").length;
    if (undetermined / qaItems.length > 0.2) {
      alerts.push("Muitas respostas com interpretacao indeterminada; recomendada revisao manual de perguntas.");
    }
    if (naCount / qaItems.length > 0.3) {
      alerts.push("Percentual elevado de 'nao aplicavel' pode mascarar problemas operacionais.");
    }
    if (weightedIssues.length > 0 && weightedIssues[0].weight <= 1 && weightedIssues[0].failureRate > 0.4) {
      alerts.push("Falhas relevantes sem pesos diferenciados; considere configurar criticidade.");
    }
  }
  if (dashboardMeta.rendered === 0) {
    alerts.push("Dados insuficientes para dashboards confiaveis; apenas indicadores essenciais foram mantidos.");
  } else if (dashboardMeta.rendered < dashboardMeta.attempted) {
    alerts.push("Parte dos dashboards foi omitida para evitar visualizacoes com baixa confianca.");
  }
  if (alerts.length === 0) {
    alerts.push("Nenhum alerta estrutural critico detectado.");
  }
  return alerts;
}

function buildRecommendationsForReview(qaItems: QAItem[]): ManualReviewConfig["questionOverrides"] {
  const byQuestion = new Map<
    string,
    {
      question: string;
      total: number;
      undetermined: number;
      inferred: SemanticQuestionPolarity;
    }
  >();
  for (const item of qaItems) {
    const current = byQuestion.get(item.question) ?? {
      question: item.question,
      total: 0,
      undetermined: 0,
      inferred: item.semanticPolarity,
    };
    current.total += 1;
    if (item.semanticResult === "undetermined") {
      current.undetermined += 1;
    }
    byQuestion.set(item.question, current);
  }

  return [...byQuestion.values()]
    .filter((q) => q.undetermined > 0 || q.inferred === "neutral")
    .slice(0, 20)
    .map((q) => ({
      questionText: q.question,
      behavior: q.inferred === "neutral" ? "positive" : q.inferred,
      includeInAnalysis: true,
      weight: 1,
      critical: false,
      reason: q.undetermined > 0 ? "Resposta ambigua recorrente" : "Pergunta com polaridade pouco clara",
    }));
}

function collectGroupStats(
  qaItems: QAItem[],
  grouping: DashboardGrouping,
  sourceScore?: SourceScoreSummary,
): GroupInspectionStats[] {
  const grouped = new Map<
    string,
    Omit<GroupInspectionStats, "ics" | "failureRate"> & { scoreSum: number; scoreCount: number }
  >();

  for (const item of qaItems) {
    const source = item.sourceRow;
    const store = toStringValue(source.loja ?? source.store ?? source.unidade ?? source.site).trim();
    const sector = toStringValue(source.setor ?? source.sector ?? source.section ?? item.section ?? source.area).trim();
    const template = toStringValue(source.template ?? source.modelo ?? source.formulario).trim();
    const periodIso = toDate(item.date ?? source.data ?? source.date);
    const period = periodIso ? periodIso.slice(0, 7) : "";
    const key =
      (grouping === "loja" && store) ||
      (grouping === "setor" && sector) ||
      (grouping === "template" && template) ||
      (grouping === "periodo" && period) ||
      (store || sector || template || period || "Nao informado");

    const current = grouped.get(key) ?? {
      group: key,
      total: 0,
      evaluated: 0,
      failures: 0,
      nonFailures: 0,
      na: 0,
      undetermined: 0,
      criticalFailures: 0,
      scoreSum: 0,
      scoreCount: 0,
    };

    current.total += 1;
    if (item.semanticResult === "real_failure") {
      current.failures += 1;
      if (item.critical || (item.weight ?? 1) >= 4) {
        current.criticalFailures += 1;
      }
    } else if (item.semanticResult === "non_failure") {
      current.nonFailures += 1;
    } else if (item.semanticResult === "na") {
      current.na += 1;
    } else {
      current.undetermined += 1;
    }
    if (item.semanticResult === "real_failure" || item.semanticResult === "non_failure") {
      current.evaluated += 1;
    }
    grouped.set(key, current);
  }

  return [...grouped.values()]
    .map((entry) => {
      const denominator = Math.max(entry.evaluated, 1);
      const failureRate = entry.failures / denominator;
      const ics = clamp((1 - failureRate) * 100, 0, 100);
      return {
        group: entry.group,
        total: entry.total,
        evaluated: entry.evaluated,
        failures: entry.failures,
        nonFailures: entry.nonFailures,
        na: entry.na,
        undetermined: entry.undetermined,
        criticalFailures: entry.criticalFailures,
        ics,
        failureRate,
      };
    })
    .sort((a, b) => b.ics - a.ics);
}

function toStatus(current: number, target?: number, invert = false): StatusLevel {
  if (target === undefined) {
    if (invert) {
      if (current <= 5) return "atingido";
      if (current <= 15) return "atencao";
      return "critico";
    }
    if (current >= 85) return "atingido";
    if (current >= 70) return "atencao";
    return "critico";
  }
  if (invert) {
    if (current <= target) return "atingido";
    if (current <= target * 1.2) return "atencao";
    return "critico";
  }
  if (current >= target) return "atingido";
  if (current >= target * 0.85) return "atencao";
  return "critico";
}

function formatKpiValue(key: KpiKey, value: number): string {
  if (
    key === "ics_medio" ||
    key === "ics_minimo" ||
    key === "ics_maximo" ||
    key === "percentual_nao_conformidade" ||
    key === "percentual_nao_aplicavel"
  ) {
    return `${value.toFixed(1)}%`;
  }
  if (key === "desvio_padrao_ics" || key === "score_medio") {
    return value.toFixed(2);
  }
  return Math.round(value).toLocaleString("pt-BR");
}

function buildCustomDashboards(args: {
  dataset: NormalizedDataset;
  qaItems: QAItem[];
  sourceScore?: SourceScoreSummary;
  configInput?: DashboardCustomizationConfig;
  shouldInspect: boolean;
}): AnalysisResult["customDashboards"] {
  const mergedVisibleSections: NonNullable<DashboardCustomizationConfig["visibleSections"]> = {
    kpiOverview: args.configInput?.visibleSections?.kpiOverview ?? true,
    sanitaryPerformance: args.configInput?.visibleSections?.sanitaryPerformance ?? true,
    okr: args.configInput?.visibleSections?.okr ?? true,
    risk: args.configInput?.visibleSections?.risk ?? true,
  };
  const merged: DashboardCustomizationConfig = {
    ...DEFAULT_DASHBOARD_CONFIG,
    ...args.configInput,
    selectedKpis:
      args.configInput?.selectedKpis && args.configInput.selectedKpis.length > 0
        ? args.configInput.selectedKpis
        : DEFAULT_DASHBOARD_CONFIG.selectedKpis,
    kpiTargets: {
      ...(DEFAULT_DASHBOARD_CONFIG.kpiTargets ?? {}),
      ...(args.configInput?.kpiTargets ?? {}),
    },
    visibleSections: mergedVisibleSections,
    okrs: args.configInput?.okrs ?? [],
  };

  const groupStats = collectGroupStats(args.qaItems, merged.grouping, args.sourceScore);
  const scores = groupStats.map((entry) => entry.ics);
  const icsMean = scores.length > 0 ? average(scores) : 0;
  const icsMin = scores.length > 0 ? Math.min(...scores) : 0;
  const icsMax = scores.length > 0 ? Math.max(...scores) : 0;
  const std = scores.length > 1 ? Math.sqrt(average(scores.map((value) => (value - icsMean) ** 2))) : 0;
  const totalInspections = groupStats.reduce((sum, entry) => sum + entry.total, 0);
  const totalFailures = groupStats.reduce((sum, entry) => sum + entry.failures, 0);
  const totalCritical = groupStats.reduce((sum, entry) => sum + entry.criticalFailures, 0);
  const totalNa = groupStats.reduce((sum, entry) => sum + entry.na, 0);
  const totalEvaluated = groupStats.reduce((sum, entry) => sum + entry.evaluated, 0);
  const nonConformityPct = totalEvaluated > 0 ? (totalFailures / totalEvaluated) * 100 : 0;
  const naPct = totalInspections > 0 ? (totalNa / totalInspections) * 100 : 0;
  const scoreMean = args.sourceScore?.compliancePercentage ?? icsMean;

  const kpiCurrent: Record<KpiKey, number> = {
    ics_medio: icsMean,
    ics_minimo: icsMin,
    ics_maximo: icsMax,
    desvio_padrao_ics: std,
    total_nao_conformidades: totalFailures,
    nao_conformidades_criticas: totalCritical,
    percentual_nao_conformidade: nonConformityPct,
    percentual_nao_aplicavel: naPct,
    score_medio: scoreMean,
    quantidade_inspecoes: totalInspections,
  };

  const kpiOverview = mergedVisibleSections.kpiOverview
    ? {
        cards:
          merged.selectedKpis.length > 0
            ? merged.selectedKpis.map((kpi) => {
                const currentValue = kpiCurrent[kpi] ?? 0;
                const targetValue = merged.kpiTargets?.[kpi];
                const status = toStatus(
                  currentValue,
                  targetValue,
                  kpi === "total_nao_conformidades" ||
                    kpi === "nao_conformidades_criticas" ||
                    kpi === "percentual_nao_conformidade" ||
                    kpi === "percentual_nao_aplicavel" ||
                    kpi === "desvio_padrao_ics",
                );
                return {
                  key: kpi,
                  label: KPI_LABELS[kpi],
                  currentValue,
                  currentValueLabel: formatKpiValue(kpi, currentValue),
                  targetValue,
                  targetValueLabel: targetValue !== undefined ? formatKpiValue(kpi, targetValue) : undefined,
                  status,
                };
              })
            : [],
        missingMessage:
          merged.selectedKpis.length === 0
            ? "Nenhum KPI foi selecionado para exibição."
            : groupStats.length === 0
              ? "Dados insuficientes para calcular os KPIs selecionados."
              : undefined,
      }
    : undefined;

  const sanitaryWidgets: DashboardWidget[] = [];
  if (args.shouldInspect && groupStats.length >= 2) {
    sanitaryWidgets.push({
      id: "sanitary-ics-by-group",
      title: `ICS por ${merged.grouping}`,
      description: "Comparação direta do índice de conformidade sanitária.",
      widgetType: "bar",
      data: groupStats.map((entry) => ({ grupo: entry.group, ics: Number(entry.ics.toFixed(2)) })),
      config: { xKey: "grupo", yKey: "ics" },
    });
    sanitaryWidgets.push({
      id: "sanitary-ranking",
      title: `Ranking sanitário por ${merged.grouping}`,
      description: "Ordenação do melhor para o pior desempenho sanitário.",
      widgetType: "bar",
      data: [...groupStats]
        .sort((a, b) => b.ics - a.ics)
        .slice(0, 12)
        .map((entry) => ({ grupo: entry.group, ics: Number(entry.ics.toFixed(2)) })),
      config: { xKey: "grupo", yKey: "ics" },
    });
    if (merged.grouping !== "periodo") {
      const byPeriod = collectGroupStats(args.qaItems, "periodo", args.sourceScore);
      if (byPeriod.length >= 2) {
        sanitaryWidgets.push({
          id: "sanitary-ics-trend",
          title: "Evolução do ICS por período",
          description: "Tendência do desempenho sanitário ao longo do tempo.",
          widgetType: "line",
          data: byPeriod
            .sort((a, b) => (a.group > b.group ? 1 : -1))
            .map((entry) => ({ periodo: entry.group, ics: Number(entry.ics.toFixed(2)) })),
          config: { xKey: "periodo", yKey: "ics" },
        });
      }
    }
    const severity = new Map<string, number>([
      ["Leve", 0],
      ["Moderada", 0],
      ["Grave", 0],
      ["Critica", 0],
    ]);
    for (const item of args.qaItems) {
      if (item.semanticResult !== "real_failure") continue;
      const severityLabel =
        (item.weight ?? 1) >= 5 || item.critical
          ? "Critica"
          : (item.weight ?? 1) >= 4
            ? "Grave"
            : (item.weight ?? 1) >= 2
              ? "Moderada"
              : "Leve";
      severity.set(severityLabel, (severity.get(severityLabel) ?? 0) + 1);
    }
    sanitaryWidgets.push({
      id: "sanitary-severity-distribution",
      title: "Distribuição de não conformidades por gravidade",
      description: "Volume de falhas dividido por criticidade.",
      widgetType: "pie",
      data: [...severity.entries()].map(([label, value]) => ({ label, value })),
      config: { nameKey: "label", valueKey: "value" },
    });
    const bySection = countBy(
      args.qaItems
        .filter((item) => item.semanticResult === "real_failure")
        .map((item) => item.section || "Sem seção"),
    );
    if (bySection.size > 0) {
      sanitaryWidgets.push({
        id: "sanitary-failures-by-section",
        title: "Não conformidades por seção",
        description: "Seções com maior concentração de não conformidades.",
        widgetType: "bar",
        data: topN(bySection, 12).map(([secao, total]) => ({ secao, total })),
        config: { xKey: "secao", yKey: "total" },
      });
    }
    const byQuestion = countBy(
      args.qaItems
        .filter((item) => item.semanticResult === "real_failure")
        .map((item) => item.question),
    );
    if (byQuestion.size > 0) {
      sanitaryWidgets.push({
        id: "sanitary-top-fail-questions",
        title: "Top perguntas com mais falhas",
        description: "Perguntas com maior recorrência de não conformidade.",
        widgetType: "bar",
        data: topN(byQuestion, 10).map(([pergunta, total]) => ({ pergunta, total })),
        config: { xKey: "pergunta", yKey: "total" },
      });
    }
    sanitaryWidgets.push({
      id: "sanitary-risky-groups",
      title: `${merged.grouping} com possível risco de multa/interdição`,
      description: "Grupos com pior ICS e maior taxa de falha.",
      widgetType: "table",
      data: [...groupStats]
        .sort((a, b) => a.ics - b.ics)
        .slice(0, 10)
        .map((entry) => ({
          grupo: entry.group,
          ics: Number(entry.ics.toFixed(2)),
          "% falha": Number((entry.failureRate * 100).toFixed(2)),
          criticas: entry.criticalFailures,
        })),
      config: { columns: ["grupo", "ics", "% falha", "criticas"] },
    });
  }

  const sanitaryPerformance = mergedVisibleSections.sanitaryPerformance
    ? {
        widgets: sanitaryWidgets,
        missingMessage:
          sanitaryWidgets.length === 0
            ? "Dados insuficientes para montar o dashboard de performance sanitária."
            : undefined,
      }
    : undefined;

  const riskRanking: Array<{
    group: string;
    ics: number;
    failureRate: number;
    criticalCount: number;
    level: RiskLevel;
  }> = groupStats.map((entry) => {
    const level: RiskLevel =
      entry.ics < 50 || entry.criticalFailures >= 3
        ? "possivel_interdicao"
        : entry.ics < 70 || entry.criticalFailures >= 1
          ? "possivel_multa"
          : entry.ics < 85
            ? "atencao"
            : "baixo_risco";
    return {
      group: entry.group,
      ics: Number(entry.ics.toFixed(2)),
      failureRate: Number((entry.failureRate * 100).toFixed(2)),
      criticalCount: entry.criticalFailures,
      level: level as RiskLevel,
    };
  });

  const riskCountsMap = new Map<RiskLevel, number>([
    ["baixo_risco", 0],
    ["atencao", 0],
    ["possivel_multa", 0],
    ["possivel_interdicao", 0],
  ]);
  for (const item of riskRanking) {
    riskCountsMap.set(item.level, (riskCountsMap.get(item.level) ?? 0) + 1);
  }
  const riskCounts: NonNullable<NonNullable<AnalysisResult["customDashboards"]>["risk"]>["counts"] = [
    { level: "baixo_risco", label: "Baixo risco", count: riskCountsMap.get("baixo_risco") ?? 0 },
    { level: "atencao", label: "Atenção", count: riskCountsMap.get("atencao") ?? 0 },
    { level: "possivel_multa", label: "Possível risco de multa", count: riskCountsMap.get("possivel_multa") ?? 0 },
    {
      level: "possivel_interdicao",
      label: "Possível risco de interdição",
      count: riskCountsMap.get("possivel_interdicao") ?? 0,
    },
  ];

  const risk = mergedVisibleSections.risk
    ? {
        counts: riskCounts,
        ranking: riskRanking.sort((a, b) => {
          const order = {
            possivel_interdicao: 4,
            possivel_multa: 3,
            atencao: 2,
            baixo_risco: 1,
          } satisfies Record<RiskLevel, number>;
          return order[b.level] - order[a.level] || a.ics - b.ics;
        }),
        missingMessage:
          riskRanking.length === 0
            ? "Dados insuficientes para calcular painel de risco sanitário."
            : undefined,
      }
    : undefined;

  const okrObjectives = (merged.okrs ?? []).map((objective) => {
    const keyResults = objective.keyResults.map((kr) => {
      const target = Math.max(kr.targetValue, 0.000001);
      const progress = clamp((kr.currentValue / target) * 100, 0, 200);
      const status = toStatus(progress, 100);
      return {
        title: kr.title,
        currentValue: kr.currentValue,
        targetValue: kr.targetValue,
        progressPercentage: Number(progress.toFixed(1)),
        status,
      };
    });
    const objectiveProgress =
      keyResults.length > 0 ? average(keyResults.map((kr) => kr.progressPercentage)) : 0;
    return {
      objectiveTitle: objective.objectiveTitle,
      progressPercentage: Number(objectiveProgress.toFixed(1)),
      status: toStatus(objectiveProgress, 100),
      keyResults,
    };
  });
  const okr = mergedVisibleSections.okr
    ? {
        objectives: okrObjectives,
        missingMessage:
          okrObjectives.length === 0
            ? "Nenhum OKR foi definido. Cadastre objetivos e resultados-chave para acompanhar progresso."
            : undefined,
      }
    : undefined;

  return {
    configApplied: merged,
    kpiOverview,
    sanitaryPerformance,
    okr,
    risk,
  };
}

export function analyzeDataset(
  parsed: ParsedTabularFile,
  normalized: NormalizedDataset,
  inference: DatasetTypeInference,
  reviewConfig?: ManualReviewConfig,
  dashboardConfigInput?: DashboardCustomizationConfig,
  debugMode = false,
): AnalysisResult {
  const columnTypes = detectColumnTypes(normalized);
  const structure = structuralQuality(normalized);

  const shouldInspect =
    inference.datasetType === "inspection_checklist" ||
    /inspection|checklist|inspe[cç][aã]o|safetyculture/i.test(parsed.fileName);
  const { items: qaItems } = shouldInspect
    ? buildInspectionItems(normalized, inference, reviewConfig)
    : { items: [] as QAItem[] };
  const weightedIssues = calculateWeightedIssues(qaItems);
  const totalItems = qaItems.length;
  const realFailures = qaItems.filter((item) => item.semanticResult === "real_failure").length;
  const conformingAnswers = qaItems.filter((item) => item.semanticResult === "non_failure").length;
  const notApplicable = qaItems.filter((item) => item.semanticResult === "na").length;
  const undetermined = qaItems.filter((item) => item.semanticResult === "undetermined").length;
  const evaluatedAnswers = realFailures + conformingAnswers;
  const ics = clamp((1 - realFailures / Math.max(evaluatedAnswers, 1)) * 100, 0, 100);
  const failuresBySection = topN(
    countBy(
      qaItems
        .filter((item) => item.semanticResult === "real_failure")
        .map((item) => item.section || "Sem secao"),
    ),
    30,
  ).map(([section, total]) => ({ section, total }));
  const failuresByQuestion = topN(
    countBy(
      qaItems
        .filter((item) => item.semanticResult === "real_failure")
        .map((item) => item.question),
    ),
    20,
  ).map(([question, total]) => ({ question, total }));

  const sourceScoreSummary = buildSourceScoreSummary(normalized);
  const summaryCards = createSummaryCards(
    normalized,
    inference,
    structure,
    qaItems,
    sourceScoreSummary,
  );
  const widgetCandidates = shouldInspect
    ? createInspectionWidgets(qaItems, weightedIssues)
    : createDatasetWidgets(normalized, columnTypes, inference.datasetType);
  const { widgets, meta: dashboardMeta } = selectDashboardWidgets(widgetCandidates, {
    rowCount: normalized.rows.length,
    structuralScore: structure.score,
    missingRatio: calculateMissingRatio(normalized),
    inferenceConfidence: confidenceFromScore(inference.confidence),
    datasetType: inference.datasetType,
  });

  const insights = createInsights(
    normalized,
    inference,
    structure,
    columnTypes,
    qaItems,
    weightedIssues,
    dashboardMeta,
  );
  const alerts = createAlerts(
    normalized,
    inference,
    structure,
    qaItems,
    weightedIssues,
    dashboardMeta,
  );
  const preview = createDataPreview(normalized);

  const appliedRules: AnalysisResult["transparency"]["appliedRules"] = reviewConfig
    ? {
        mode: reviewConfig.mode,
        binaryInterpretationMode: reviewConfig.binaryInterpretationMode,
        questionOverrides: reviewConfig.questionOverrides.length,
        sectionWeights: reviewConfig.sectionWeights.length,
        notes: reviewConfig.notes || "",
      }
    : {
        mode: "quick",
        binaryInterpretationMode: "auto",
        questionOverrides: 0,
        sectionWeights: 0,
        notes: "Analise automatica sem revisao manual.",
      };

  const summaryText = [
    `Tipo inferido: ${inference.datasetType} (${Math.round(confidenceFromScore(inference.confidence) * 100)}% de confianca).`,
    `Estrutura: ${structure.label} com ${normalized.rows.length} linhas e ${normalized.headers.length} colunas.`,
    qaItems.length > 0
      ? `Checklist interpretado com ${qaItems.filter((item) => item.semanticResult === "real_failure").length} falhas reais em ${qaItems.length} itens avaliados.`
      : "Analise executada com heuristicas automaticas para dados tabulares gerais.",
  ].join(" ");
  const summaryTextParts = [summaryText];
  if (sourceScoreSummary) {
    summaryTextParts.push(sourceScoreSummary.explanation);
    if (sourceScoreSummary.isMaxScore) {
      summaryTextParts.push("Nenhuma nao conformidade identificada. Pontuacao maxima atingida.");
    }
  }
  if (qaItems.length > 0) {
    summaryTextParts.push(
      `ICS calculado pelo sistema: ${ics.toFixed(1)}% (Sim / (Sim + Não) = ${conformingAnswers}/${evaluatedAnswers}).`,
    );
  }
  const mergedSummaryText = summaryTextParts.join(" ");
  const customDashboards = buildCustomDashboards({
    dataset: normalized,
    qaItems,
    sourceScore: sourceScoreSummary,
    configInput: dashboardConfigInput,
    shouldInspect,
  });

  return {
    datasetType: inference.datasetType,
    datasetTypeConfidence: confidenceFromScore(inference.confidence),
    rowCount: normalized.rows.length,
    columnCount: normalized.headers.length,
    detectedColumns: normalized.headers,
    parsingDiagnostics:
      debugMode
        ? {
            partial: parsed.errors.length > 0 || parsed.warnings.length > 0,
            warnings: parsed.warnings,
            errors: parsed.errors,
          }
        : {
            partial: false,
            warnings: [],
            errors: [],
          },
    structuralQuality: {
      score: structure.score,
      label: structure.label,
      notes: structure.notes,
    },
    columnProfiles:
      debugMode
        ? normalized.headers.map((header) => ({
            name: header,
            type: columnTypes[header],
            missingCount: normalized.rows.reduce(
              (sum, row) => sum + (isMissing(row[header]) ? 1 : 0),
              0,
            ),
            sampleValues: normalized.rows
              .map((row) => toStringValue(row[header]))
              .filter((value) => value.length > 0)
              .slice(0, 5),
          }))
        : [],
    summaryCards,
    dashboardWidgets: widgets,
    insights,
    alerts,
    summaryText: mergedSummaryText,
    interpretedPreview: preview,
    sourceScore: sourceScoreSummary,
    qaAnalysis:
      totalItems > 0
        ? {
            totalItems,
            realFailures,
            nonFailures: conformingAnswers,
            conformingAnswers,
            notApplicable,
            undetermined,
            ics,
            sourceScore: sourceScoreSummary,
            bySection: failuresBySection,
            failuresBySection,
            topFailedQuestions: failuresByQuestion,
            failuresByQuestion,
            weightedIssues,
            ambiguousQuestions: buildRecommendationsForReview(qaItems),
          }
        : undefined,
    customDashboards,
    transparency: {
      normalizationActions: normalized.normalizationNotes,
      parsingWarnings: [...parsed.warnings, ...parsed.errors],
      appliedRules,
    },
    normalizedRowsForExport: normalized.rows,
  };
}
