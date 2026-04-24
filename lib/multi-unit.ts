import {
  AnalysisResult,
  DashboardWidget,
  MultiUnitAnalysisResult,
  MultiUnitComparisonRow,
  MultiUnitParetoRow,
  WeightedRiskLevel,
} from "@/lib/types";
import { average, countBy, toStringValue, topN } from "@/lib/utils";

type MultiUnitInput = {
  unitId: string;
  fileName: string;
  userLabel?: string;
  analysis: AnalysisResult;
};

type MultiUnitBuilderArgs = {
  units: MultiUnitInput[];
  grouping: "loja" | "setor";
  totalFiles: number;
  includeUnitPareto?: boolean;
  errors?: MultiUnitAnalysisResult["errors"];
};

const RISK_ORDER: Record<WeightedRiskLevel, number> = {
  regular: 1,
  atencao: 2,
  risco_multa: 3,
  risco_interdicao: 4,
};

const RISK_LABEL: Record<WeightedRiskLevel, string> = {
  regular: "Regular",
  atencao: "Atenção",
  risco_multa: "Risco de multa",
  risco_interdicao: "Risco de interdição",
};

function safePercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
}

function stdDev(values: number[]): number {
  if (values.length <= 1) return 0;
  const mean = average(values);
  return Math.sqrt(average(values.map((value) => (value - mean) ** 2)));
}

function fileNameToLabel(fileName: string): string {
  return fileName
    .replace(/\.[^/.]+$/g, "")
    .replace(/[_\-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function selectMostFrequent(rows: Record<string, unknown>[], keys: string[]): string | undefined {
  if (rows.length === 0) return undefined;
  const values: string[] = [];
  for (const row of rows.slice(0, 800)) {
    for (const key of keys) {
      const rowKeys = Object.keys(row);
      const actualKey = rowKeys.find((rowKey) => rowKey.toLowerCase() === key);
      if (!actualKey) continue;
      const value = toStringValue(row[actualKey]).trim();
      if (value) {
        values.push(value);
      }
    }
  }
  if (values.length === 0) return undefined;
  return topN(countBy(values), 1)[0]?.[0];
}

function inferUnitName(
  analysis: AnalysisResult,
  grouping: "loja" | "setor",
  fileName: string,
  userLabel?: string,
): string {
  const rows = analysis.normalizedRowsForExport as Record<string, unknown>[];
  const metadataKeys =
    grouping === "setor"
      ? ["setor", "sector", "section", "area", "departamento"]
      : ["loja", "store", "site", "location", "unidade", "branch", "local"];
  const metadataLabel = selectMostFrequent(rows ?? [], metadataKeys);
  // Prioridade solicitada: metadata > nome do arquivo > rótulo definido pelo usuário.
  return metadataLabel || fileNameToLabel(fileName) || userLabel?.trim() || "Unidade sem identificação";
}

function riskLevelFromResult(result: AnalysisResult): WeightedRiskLevel {
  return result.qaAnalysis?.weightedRiskClassification ?? "regular";
}

function buildComparisonRow(input: MultiUnitInput, grouping: "loja" | "setor"): MultiUnitComparisonRow {
  const qa = input.analysis.qaAnalysis;
  const realFailures = qa?.realFailures ?? 0;
  const nonFailures = qa?.nonFailures ?? 0;
  const evaluated = realFailures + nonFailures;
  const weightedIssues = qa?.weightedIssues ?? [];
  const criticalFailures = weightedIssues
    .filter((item) => item.critical || item.weight >= 3)
    .reduce((sum, item) => sum + item.failures, 0);

  const icsSimple = safePercent(qa?.icsSimple ?? input.analysis.sourceScore?.compliancePercentage ?? 0);
  const icsWeighted = safePercent(qa?.icsWeighted ?? input.analysis.sourceScore?.compliancePercentage ?? 0);
  const weightedFailures = qa?.totalWeightedFailures ?? realFailures;
  const weightedRiskScore = qa?.weightedRiskScore ?? (100 - icsWeighted);
  const riskLevel = riskLevelFromResult(input.analysis);
  return {
    unitId: input.unitId,
    fileName: input.fileName,
    unitName: inferUnitName(input.analysis, grouping, input.fileName, input.userLabel),
    userLabel: input.userLabel,
    icsSimple: Number(icsSimple.toFixed(2)),
    icsWeighted: Number(icsWeighted.toFixed(2)),
    totalFailures: realFailures,
    weightedFailures: Number(weightedFailures.toFixed(2)),
    criticalFailures,
    weightedRiskScore: Number(weightedRiskScore.toFixed(2)),
    riskLevel,
    failureRatePercentage: Number((evaluated > 0 ? (realFailures / evaluated) * 100 : 0).toFixed(2)),
  };
}

function sortRanking(rows: MultiUnitComparisonRow[]): MultiUnitComparisonRow[] {
  return [...rows].sort(
    (a, b) =>
      RISK_ORDER[b.riskLevel] - RISK_ORDER[a.riskLevel] ||
      b.weightedFailures - a.weightedFailures ||
      a.icsWeighted - b.icsWeighted ||
      b.criticalFailures - a.criticalFailures,
  );
}

function buildGlobalPareto(rows: MultiUnitComparisonRow[], units: MultiUnitInput[]): MultiUnitAnalysisResult["globalPareto"] {
  const grouped = new Map<string, { falhas: number; impacto: number }>();
  for (const unit of units) {
    const issues = unit.analysis.qaAnalysis?.weightedIssues ?? [];
    for (const issue of issues) {
      if (issue.failures <= 0) continue;
      const key = issue.question;
      const current = grouped.get(key) ?? { falhas: 0, impacto: 0 };
      current.falhas += issue.failures;
      current.impacto += issue.failures * issue.weight;
      grouped.set(key, current);
    }
  }
  const totalImpact = [...grouped.values()].reduce((sum, item) => sum + item.impacto, 0);
  let cumulative = 0;
  const ranking: MultiUnitParetoRow[] = [...grouped.entries()]
    .map(([causa, values]) => ({
      causa,
      frequenciaFalhas: values.falhas,
      impactoPonderado: Number(values.impacto.toFixed(2)),
      impactoPercentual: totalImpact > 0 ? Number(((values.impacto / totalImpact) * 100).toFixed(2)) : 0,
      impactoAcumulado: 0,
    }))
    .sort((a, b) => b.impactoPonderado - a.impactoPonderado)
    .map((row) => {
      cumulative += row.impactoPercentual;
      return { ...row, impactoAcumulado: Number(Math.min(100, cumulative).toFixed(2)) };
    });

  const widgets: DashboardWidget[] = [
    {
      id: "multi-global-pareto-impacto",
      title: "Pareto global de falhas (todas as unidades)",
      description: "Principais causas combinadas por impacto ponderado acumulado.",
      widgetType: "bar",
      data: ranking.slice(0, 20).map((row) => ({
        causa: row.causa,
        impacto: row.impactoPonderado,
        acumulado: row.impactoAcumulado,
      })),
      config: { xKey: "causa", yKey: "impacto" },
    },
    {
      id: "multi-global-pareto-ranking",
      title: "Ranking Pareto global",
      description: "80/20 das causas com maior impacto global de risco.",
      widgetType: "table",
      data: ranking.slice(0, 20).map((row) => ({
        causa: row.causa,
        frequencia: row.frequenciaFalhas,
        impacto_ponderado: row.impactoPonderado,
        impacto_percentual: `${row.impactoPercentual.toFixed(2)}%`,
        acumulado: `${row.impactoAcumulado.toFixed(2)}%`,
      })),
      config: {},
    },
  ];

  if (rows.length === 0) {
    return { ranking: [], widgets: [] };
  }
  return { ranking, widgets };
}

export function buildMultiUnitAnalysis(args: MultiUnitBuilderArgs): MultiUnitAnalysisResult {
  const comparisonTable = args.units.map((unit) => buildComparisonRow(unit, args.grouping));
  const ranking = sortRanking(comparisonTable);
  const riskDistribution: MultiUnitAnalysisResult["riskDistribution"] = (
    ["regular", "atencao", "risco_multa", "risco_interdicao"] as WeightedRiskLevel[]
  ).map((level) => ({
    level,
    label: RISK_LABEL[level],
    count: comparisonTable.filter((row) => row.riskLevel === level).length,
  }));
  const icsValues = comparisonTable.map((row) => row.icsWeighted);
  const icsWeightedStdDev = stdDev(icsValues);
  const meanIcs = average(icsValues);
  const highestVariation = comparisonTable
    .map((row) => ({ unitName: row.unitName, delta: Math.abs(row.icsWeighted - meanIcs) }))
    .sort((a, b) => b.delta - a.delta)[0];

  const best = [...comparisonTable].sort(
    (a, b) => b.icsWeighted - a.icsWeighted || a.weightedFailures - b.weightedFailures,
  )[0];
  const worst = [...comparisonTable].sort(
    (a, b) => a.icsWeighted - b.icsWeighted || b.weightedFailures - a.weightedFailures,
  )[0];
  const highestRisk = ranking[0];

  const widgets: DashboardWidget[] = [
    {
      id: "multi-ranking-geral",
      title: "Ranking sanitário geral",
      description: "Prioriza risco, falhas ponderadas e menor ICS ponderado.",
      widgetType: "bar",
      data: ranking.slice(0, 20).map((row) => ({
        unidade: row.unitName,
        score_risco: row.weightedRiskScore,
      })),
      config: { xKey: "unidade", yKey: "score_risco" },
    },
    {
      id: "multi-ics-por-unidade",
      title: "ICS por unidade",
      description: "Comparação percentual normalizada por unidade.",
      widgetType: "bar",
      data: comparisonTable.map((row) => ({
        unidade: row.unitName,
        ics: row.icsSimple,
      })),
      config: { xKey: "unidade", yKey: "ics" },
    },
    {
      id: "multi-ics-ponderado-por-unidade",
      title: "ICS ponderado por unidade",
      description: "Comparação por gravidade das não conformidades.",
      widgetType: "bar",
      data: comparisonTable.map((row) => ({
        unidade: row.unitName,
        ics_ponderado: row.icsWeighted,
      })),
      config: { xKey: "unidade", yKey: "ics_ponderado" },
    },
    {
      id: "multi-risco-distribuicao",
      title: "Distribuição de risco entre unidades",
      description: "Quantidade de unidades por faixa de risco sanitário.",
      widgetType: "pie",
      data: riskDistribution.map((row) => ({ label: row.label, value: row.count })),
      config: { nameKey: "label", valueKey: "value" },
    },
    {
      id: "multi-falhas-gravissimas",
      title: "Falhas gravíssimas por unidade",
      description: "Concentração de itens críticos para priorização imediata.",
      widgetType: "bar",
      data: ranking.slice(0, 20).map((row) => ({
        unidade: row.unitName,
        falhas_gravissimas: row.criticalFailures,
      })),
      config: { xKey: "unidade", yKey: "falhas_gravissimas" },
    },
  ];

  const globalPareto = buildGlobalPareto(comparisonTable, args.units);
  const perUnitPareto = args.includeUnitPareto
    ? args.units.map((unit) => ({
        unitName: inferUnitName(unit.analysis, args.grouping, unit.fileName, unit.userLabel),
        ranking: (unit.analysis.qaAnalysis?.weightedIssues ?? [])
          .filter((issue) => issue.failures > 0)
          .map((issue) => ({
            causa: issue.question,
            frequenciaFalhas: issue.failures,
            impactoPonderado: Number((issue.failures * issue.weight).toFixed(2)),
            impactoPercentual: 0,
            impactoAcumulado: 0,
          }))
          .sort((a, b) => b.impactoPonderado - a.impactoPonderado)
          .slice(0, 8),
      }))
    : undefined;

  const totalCritical = comparisonTable.reduce((sum, row) => sum + row.criticalFailures, 0);
  const criticalLeader = [...comparisonTable].sort((a, b) => b.criticalFailures - a.criticalFailures)[0];
  const criticalShare = totalCritical > 0 ? ((criticalLeader?.criticalFailures ?? 0) / totalCritical) * 100 : 0;
  const topParetoCause = globalPareto.ranking[0];

  const insights: string[] = [];
  if (highestRisk) {
    insights.push(`A unidade ${highestRisk.unitName} apresenta o maior risco sanitário comparativo.`);
  }
  if (best) {
    insights.push(`A unidade ${best.unitName} possui o melhor desempenho no ICS ponderado.`);
  }
  if (icsWeightedStdDev >= 10) {
    insights.push("Existe alta variação entre unidades (desvio padrão elevado), indicando inconsistência operacional.");
  }
  if (criticalLeader && criticalLeader.criticalFailures > 0 && criticalShare >= 35) {
    insights.push(`As falhas críticas estão concentradas na unidade ${criticalLeader.unitName}.`);
  }
  if (topParetoCause && topParetoCause.impactoPercentual >= 20) {
    insights.push(
      `O padrão indica problema sistêmico em áreas recorrentes, com destaque para "${topParetoCause.causa}".`,
    );
  }
  while (insights.length < 5) {
    insights.push("A comparação multi-unidade foi normalizada por percentuais para preservar justiça entre bases diferentes.");
  }

  return {
    grouping: args.grouping,
    totalFiles: args.totalFiles,
    comparedFiles: comparisonTable.length,
    comparisonTable,
    ranking,
    bestWorst: {
      bestUnit: best?.unitName,
      worstUnit: worst?.unitName,
      highestRiskUnit: highestRisk?.unitName,
      highestVariationUnit: highestVariation?.unitName,
      icsWeightedStdDev: Number(icsWeightedStdDev.toFixed(2)),
    },
    riskDistribution,
    widgets: [...widgets, ...globalPareto.widgets],
    globalPareto,
    perUnitPareto,
    insights,
    errors: args.errors ?? [],
  };
}
