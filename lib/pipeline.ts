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
