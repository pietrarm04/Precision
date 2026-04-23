import { analyzeDataset } from "@/lib/analysis";
import { inferDatasetType } from "@/lib/heuristics";
import { normalizeDataset } from "@/lib/normalizer";
import { parseTabularFile } from "@/lib/parser";
import { AnalysisResult, ManualReviewConfig } from "@/lib/types";

export function runAnalysisPipeline(
  fileName: string,
  bytes: ArrayBuffer,
  options?: { mode?: "quick" | "reviewed"; rules?: ManualReviewConfig },
): AnalysisResult {
  const parsed = parseTabularFile(fileName, bytes);
  if (parsed.headers.length === 0 || parsed.rows.length === 0) {
    const parseWarnings = [...parsed.warnings, ...parsed.errors];
    const warningMessage =
      parseWarnings.length > 0
        ? parseWarnings
        : ["Nao foi possivel interpretar totalmente o arquivo. Analise parcial disponivel."];
    return {
      datasetType: "generic",
      datasetTypeConfidence: 0.2,
      rowCount: parsed.rows.length,
      columnCount: parsed.headers.length,
      detectedColumns: parsed.headers,
      parsingDiagnostics: {
        partial: true,
        warnings: parsed.warnings,
        errors: parsed.errors,
      },
      structuralQuality: {
        score: 0.25,
        label: "baguncado",
        notes: warningMessage,
      },
      columnProfiles: parsed.headers.map((header) => ({
        name: header,
        type: "empty",
        missingCount: parsed.rows.length,
        sampleValues: [],
      })),
      summaryCards: [
        { label: "Linhas", value: parsed.rows.length.toLocaleString("pt-BR") },
        { label: "Colunas", value: parsed.headers.length.toLocaleString("pt-BR") },
        { label: "Tipo inferido", value: "generic (baixa confianca)", emphasis: "warning" },
        { label: "Qualidade estrutural", value: "baguncado (25%)", emphasis: "danger" },
      ],
      dashboardWidgets: [],
      insights: [
        "O arquivo foi lido parcialmente e nao possui estrutura suficiente para analise completa.",
        "Mesmo com limitacoes, os metadados basicos foram preservados para inspecao.",
        "Recomenda-se revisar delimitadores, cabecalhos e consistencia de linhas no arquivo de origem.",
        "Colunas e tipos podem ter sido inferidos de forma conservadora devido a baixa confiabilidade.",
        "A analise priorizou retornar o melhor resultado parcial possivel sem interromper o fluxo.",
      ],
      alerts: [
        "Leitura parcial: estrutura tabular incompleta ou inconsistente.",
        ...warningMessage,
      ],
      summaryText:
        "Analise parcial: o arquivo nao pode ser totalmente compreendido, mas o sistema retornou o melhor diagnostico estrutural disponivel.",
      interpretedPreview: parsed.rows.slice(0, 12),
      transparency: {
        normalizationActions: [],
        parsingWarnings: warningMessage,
        appliedRules: {
          mode: options?.mode ?? "quick",
          binaryInterpretationMode: options?.rules?.binaryInterpretationMode ?? "auto",
          questionOverrides: options?.rules?.questionOverrides.length ?? 0,
          sectionWeights: options?.rules?.sectionWeights.length ?? 0,
          notes: "Resposta parcial gerada por robustez de parsing.",
        },
      },
      normalizedRowsForExport: parsed.rows,
    };
  }
  const normalized = normalizeDataset(parsed);
  const inference = inferDatasetType(normalized.headers, normalized.rows);

  const rules: ManualReviewConfig | undefined =
    options?.mode === "reviewed" && options?.rules
      ? {
          ...options.rules,
          mode: "reviewed",
        }
      : undefined;

  const result = analyzeDataset(parsed, normalized, inference, rules);
  return {
    ...result,
    summaryText: buildSummaryText(result),
  };
}

function buildSummaryText(result: AnalysisResult): string {
  const confidence = Math.round(result.datasetTypeConfidence * 100);
  const quality = `${result.structuralQuality.label} (${Math.round(result.structuralQuality.score * 100)}%)`;
  const firstInsight = result.insights[0] ?? "Sem insight adicional.";
  const qaSnippet = result.qaAnalysis
    ? `Itens de inspecao: ${result.qaAnalysis.totalItems}; falhas reais: ${result.qaAnalysis.realFailures}.`
    : "Leitura geral sem modulo de checklist aplicado.";

  return [
    `Dataset inferido: ${result.datasetType} com confianca de ${confidence}%.`,
    `Volume: ${result.rowCount} linhas e ${result.columnCount} colunas.`,
    `Qualidade estrutural: ${quality}.`,
    qaSnippet,
    `Destaque: ${firstInsight}`,
  ].join(" ");
}
