import {
  AnalysisResult,
  ColumnType,
  DashboardWidget,
  DatasetType,
  DatasetTypeInference,
  ManualReviewConfig,
  NormalizedDataset,
  ParsedTabularFile,
  QAItem,
  QAOutcome,
  SemanticQuestionPolarity,
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

const defaultIgnoredRegex = /(coment[aá]rio|evid[eê]ncia|foto|anexo|assinatura|observa[cç][aã]o)/i;

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
  if (statusPassTokens.some((token) => normalized.includes(token))) {
    return "pass";
  }
  if (statusFailTokens.some((token) => normalized.includes(token))) {
    return "fail";
  }
  if (yesTokens.includes(normalized)) {
    return "yes";
  }
  if (noTokens.includes(normalized)) {
    return "no";
  }
  return "unknown";
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

function applySemanticRule(
  questionPolarity: SemanticQuestionPolarity,
  outcome: QAOutcome,
  responseRaw: string,
): "real_failure" | "non_failure" | "na" | "undetermined" {
  if (outcome === "na") {
    return "na";
  }
  if (outcome === "unknown") {
    return "undetermined";
  }
  if (outcome === "fail") {
    return "real_failure";
  }
  if (outcome === "pass") {
    return "non_failure";
  }
  if (outcome === "yes") {
    if (questionPolarity === "negative") {
      return "real_failure";
    }
    return "non_failure";
  }
  if (outcome === "no") {
    if (questionPolarity === "positive") {
      return "real_failure";
    }
    return "non_failure";
  }
  if (responseRaw.toLowerCase().includes("não conforme") || responseRaw.toLowerCase().includes("nao conforme")) {
    return "real_failure";
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
  const defaultMode = config?.binaryInterpretationMode ?? "auto";
  if (defaultMode === "treat_no_as_failure") {
    return "positive";
  }
  if (defaultMode === "treat_yes_as_failure_for_negative_questions") {
    const inferred = inferQuestionPolarity(question);
    if (inferred !== "neutral") {
      return inferred;
    }
  }
  if (defaultMode === "treat_yes_as_positive") {
    return "positive";
  }
  if (outcome === "yes" || outcome === "no") {
    return inferQuestionPolarity(question);
  }
  return inferQuestionPolarity(question);
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
  const items: QAItem[] = [];
  let ignoredCount = 0;

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
    const polarity = resolveQuestionType(question, outcome, config);
    const semantics = applySemanticRule(polarity, outcome, responseRaw);
    const section = sectionCol ? toStringValue(row[sectionCol]).trim() : "";
    const criticalOverride = config?.questionOverrides.find((q) => q.questionText === question)?.critical ?? false;
    const weight = questionWeight(question, section || undefined, config);

    items.push({
      question: question || "(pergunta nao identificada)",
      responseRaw,
      normalizedOutcome: outcome,
      section: section || undefined,
      date: dateCol ? toStringValue(row[dateCol]) : undefined,
      semanticPolarity: polarity,
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

function createSummaryCards(
  dataset: NormalizedDataset,
  inference: DatasetTypeInference,
  structure: ReturnType<typeof structuralQuality>,
  qaItems: QAItem[],
): SummaryCard[] {
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

  if (qaItems.length > 0) {
    const failures = qaItems.filter((item) => item.semanticResult === "real_failure").length;
    const na = qaItems.filter((item) => item.semanticResult === "na").length;
    cards.push({
      label: "Falhas reais",
      value: `${failures} (${qaItems.length > 0 ? Math.round((failures / qaItems.length) * 100) : 0}%)`,
      emphasis: failures / Math.max(qaItems.length, 1) > 0.2 ? "danger" : "default",
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

  const bySection = countBy(
    qaItems
      .filter((item) => item.semanticResult === "real_failure")
      .map((item) => item.section || "Sem secao"),
  );
  widgets.push({
    id: "inspection-sections-failures",
    title: "Falhas por secao",
    description: "Sinaliza areas mais problematicas.",
    widgetType: "bar",
    data: topN(bySection, 10).map(([section, count]) => ({ section, count })),
    config: { xKey: "section", yKey: "count" },
  });

  const byQuestion = countBy(
    qaItems
      .filter((item) => item.semanticResult === "real_failure")
      .map((item) => item.question),
  );
  widgets.push({
    id: "inspection-questions-failures",
    title: "Perguntas com mais falhas",
    description: "Ranking de itens com maior recorrencia de nao conformidade real.",
    widgetType: "bar",
    data: topN(byQuestion, 12).map(([question, count]) => ({ question, count })),
    config: { xKey: "question", yKey: "count" },
  });

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

  if (total > 0) {
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

function createGenericWidgets(
  dataset: NormalizedDataset,
  columnTypes: Record<string, ColumnType>,
  datasetType: DatasetType,
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

  if (categorical.length > 0) {
    const target = categorical[0]?.column;
    if (target) {
      const counts = countBy(
        dataset.rows
          .map((row) => toStringValue(row[target]).trim())
          .filter((value) => value.length > 0),
      );
      widgets.push({
        id: "top-category",
        title: `Distribuicao por ${normalizeHeader(target)}`,
        description: "Ranking das categorias mais relevantes.",
        widgetType: "bar",
        data: topN(counts, MAX_CATEGORY_FOR_BAR).map(([category, count]) => ({ category, count })),
        config: { xKey: "category", yKey: "count" },
      });
    }
  }

  const bestNumeric = numeric[0];
  if (bestNumeric) {
    widgets.push({
      id: "numeric-summary",
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

  if (datasetType === "sales" || datasetType === "finance") {
    const moneyColumns = dataset.headers.filter((h) =>
      /(fatur|receita|valor|total|price|amount|custo|expense|despesa)/i.test(h.toLowerCase()),
    );
    const target = moneyColumns[0];
    const groupColumn =
      categorical.find((entry) => entry.column !== target && entry.distinct <= 25)?.column ?? categorical[0]?.column;
    if (target && groupColumn) {
      const grouped = new Map<string, number>();
      for (const row of dataset.rows) {
        const group = toStringValue(row[groupColumn]).trim() || "Nao informado";
        const amount = safeNumber(row[target]) ?? 0;
        grouped.set(group, (grouped.get(group) ?? 0) + amount);
      }
      widgets.push({
        id: "money-group-ranking",
        title: `Ranking por ${normalizeHeader(groupColumn)}`,
        description: `Concentracao de ${datasetType === "sales" ? "faturamento" : "valor"} por grupo.`,
        widgetType: "bar",
        data: topN(grouped, 12).map(([group, amount]) => ({ group, amount: Number(amount.toFixed(2)) })),
        config: { xKey: "group", yKey: "amount" },
      });
    }
  }

  return widgets;
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
): string[] {
  const insights: string[] = [];
  const confidence = Math.round(confidenceFromScore(inference.confidence) * 100);
  insights.push(
    `O dataset foi classificado como ${inference.datasetType} com confianca de ${confidence}%, usando nomes de colunas e padroes de valores.`,
  );

  const missingRatio = dataset.rows.length
    ? dataset.rows.reduce((sum, row) => {
        return (
          sum +
          dataset.headers.reduce((acc, header) => acc + (isMissing(row[header]) ? 1 : 0), 0)
        );
      }, 0) /
      (dataset.rows.length * Math.max(dataset.headers.length, 1))
    : 0;
  insights.push(
    `A qualidade estrutural foi avaliada como ${structure.label}; cerca de ${Math.round(
      missingRatio * 100,
    )}% das celulas estao vazias.`,
  );

  const categorical = topCategoricalColumns(dataset, columnTypes);
  if (categorical[0]) {
    const dominance = dataset.rows.length ? (categorical[0].topCount / dataset.rows.length) * 100 : 0;
    insights.push(
      `Na coluna "${categorical[0].column}", o valor "${categorical[0].topValue}" concentra ${dominance.toFixed(
        1,
      )}% dos registros, indicando possivel dependencia de poucas categorias.`,
    );
  }

  const numeric = numericProfiles(dataset, columnTypes);
  if (numeric[0]) {
    insights.push(
      `A coluna numerica "${numeric[0].column}" apresenta media ${numeric[0].mean.toFixed(
        2,
      )} e amplitude ${numeric[0].range.toFixed(2)}, sugerindo ${numeric[0].range > numeric[0].mean * 2 ? "alta dispersao" : "dispersao moderada"}.`,
    );
  }

  if (qaItems.length > 0) {
    const failures = qaItems.filter((item) => item.semanticResult === "real_failure").length;
    const na = qaItems.filter((item) => item.semanticResult === "na").length;
    insights.push(
      `Na interpretacao de checklist/inspecao foram avaliados ${qaItems.length} itens, com ${(
        (failures / Math.max(qaItems.length, 1)) *
        100
      ).toFixed(1)}% de falha real e ${((na / Math.max(qaItems.length, 1)) * 100).toFixed(1)}% de nao aplicavel.`,
    );
    if (weightedIssues[0]) {
      insights.push(
        `Considerando pesos e criticidade, a prioridade principal e "${weightedIssues[0].question}" com score ponderado ${weightedIssues[0].weightedScore.toFixed(
          2,
        )}.`,
      );
    }
  }

  while (insights.length < 5) {
    insights.push(
      "A analise manteve postura conservadora: quando a confianca da inferencia e baixa, os resultados sao apresentados como indicativos e nao conclusivos.",
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

export function analyzeDataset(
  parsed: ParsedTabularFile,
  normalized: NormalizedDataset,
  inference: DatasetTypeInference,
  reviewConfig?: ManualReviewConfig,
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

  const summaryCards = createSummaryCards(normalized, inference, structure, qaItems);
  const widgets = shouldInspect
    ? createInspectionWidgets(qaItems, weightedIssues)
    : createGenericWidgets(normalized, columnTypes, inference.datasetType);

  const insights = createInsights(normalized, inference, structure, columnTypes, qaItems, weightedIssues);
  const alerts = createAlerts(normalized, inference, structure, qaItems, weightedIssues);
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

  return {
    datasetType: inference.datasetType,
    datasetTypeConfidence: confidenceFromScore(inference.confidence),
    rowCount: normalized.rows.length,
    columnCount: normalized.headers.length,
    structuralQuality: {
      score: structure.score,
      label: structure.label,
      notes: structure.notes,
    },
    columnProfiles: normalized.headers.map((header) => ({
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
    })),
    summaryCards,
    dashboardWidgets: widgets,
    insights,
    alerts,
    summaryText,
    interpretedPreview: preview,
    qaAnalysis:
      qaItems.length > 0
        ? {
            totalItems: qaItems.length,
            realFailures: qaItems.filter((item) => item.semanticResult === "real_failure").length,
            nonFailures: qaItems.filter((item) => item.semanticResult === "non_failure").length,
            notApplicable: qaItems.filter((item) => item.semanticResult === "na").length,
            undetermined: qaItems.filter((item) => item.semanticResult === "undetermined").length,
            bySection: topN(
              countBy(
                qaItems.map((item) => item.section || "Sem secao"),
              ),
              30,
            ).map(([section, total]) => ({ section, total })),
            topFailedQuestions: topN(
              countBy(
                qaItems
                  .filter((item) => item.semanticResult === "real_failure")
                  .map((item) => item.question),
              ),
              20,
            ).map(([question, total]) => ({ question, total })),
            weightedIssues,
            ambiguousQuestions: buildRecommendationsForReview(qaItems),
          }
        : undefined,
    transparency: {
      normalizationActions: normalized.normalizationNotes,
      parsingWarnings: parsed.warnings,
      appliedRules,
    },
    normalizedRowsForExport: normalized.rows,
  };
}
