"use client";

import { AnalysisResult } from "@/lib/types";
import { ChartRenderer } from "@/components/ChartRenderer";
import { StatCards } from "@/components/StatCards";

type Props = {
  result: AnalysisResult;
};

function qualityPill(score: number): { text: string; cls: string } {
  if (score < 0.5) return { text: "Estrutura fragil", cls: "pill danger" };
  if (score < 0.75) return { text: "Estrutura intermediaria", cls: "pill warn" };
  return { text: "Estrutura estavel", cls: "pill success" };
}

export function ResultsView({ result }: Props) {
  const q = qualityPill(result.structuralQuality.score);
  const sourceScore = result.sourceScore ?? result.qaAnalysis?.sourceScore;
  const complianceText = sourceScore
    ? `${sourceScore.compliancePercentage.toFixed(sourceScore.isMaxScore ? 0 : 1)}% de conformidade`
    : null;
  const complianceExplanation = sourceScore?.isMaxScore
    ? "Nenhuma não conformidade identificada. Pontuação máxima atingida."
    : sourceScore
      ? `Pontuação no arquivo de origem: ${sourceScore.score}/${sourceScore.totalScore}. Nenhuma não conformidade identificada.`
      : null;
  return (
    <div className="grid" style={{ gap: 20 }}>
      <div className="card">
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <div>
            <h2 style={{ margin: "0 0 6px" }}>Resultado da analise</h2>
            <p style={{ margin: 0, color: "var(--muted)" }}>
              Tipo inferido: <strong>{result.datasetType}</strong> com{" "}
              <strong>{Math.round(result.datasetTypeConfidence * 100)}%</strong> de confianca
            </p>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span className={q.cls}>{q.text}</span>
          </div>
        </div>
      </div>

      <StatCards cards={result.summaryCards} />

      {sourceScore && (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Interpretação da pontuação</h3>
          <p style={{ margin: "0 0 8px", fontSize: 24, fontWeight: 700 }}>{complianceText}</p>
          <p style={{ margin: "0 0 8px", color: "var(--muted)" }}>
            A pontuação foi lida diretamente do arquivo de origem. O valor{" "}
            <strong>
              {sourceScore.score}/{sourceScore.totalScore}
            </strong>{" "}
            significa{" "}
            {sourceScore.compliancePercentage.toFixed(sourceScore.isMaxScore ? 0 : 1)}% da pontuação total
            disponível.
          </p>
          {complianceExplanation && (
            <p style={{ margin: 0, color: sourceScore.isMaxScore ? "var(--success)" : "var(--muted)" }}>
              {complianceExplanation}
            </p>
          )}
          <p style={{ marginTop: 10, marginBottom: 0, fontSize: 12, color: "var(--muted)" }}>
            Valores brutos (apoio): score={sourceScore.score} | totalScore={sourceScore.totalScore}
          </p>
        </div>
      )}

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Dashboard automatico</h3>
        <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))" }}>
          {result.dashboardWidgets.map((widget) => (
            <ChartRenderer key={widget.id} widget={widget} />
          ))}
        </div>
      </div>

      <div className="grid" style={{ gridTemplateColumns: "2fr 1fr", alignItems: "start" }}>
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Insights automaticos</h3>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {result.insights.map((insight, idx) => (
              <li key={`${insight}-${idx}`} style={{ marginBottom: 8 }}>
                {insight}
              </li>
            ))}
          </ul>
        </div>
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Alertas</h3>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {result.alerts.map((alert, idx) => (
              <li key={`${alert}-${idx}`} style={{ marginBottom: 8 }}>
                {alert}
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Resumo analitico</h3>
        <p style={{ color: "var(--muted)", marginBottom: 0 }}>{result.summaryText}</p>
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Transparencia da analise</h3>
        <ul style={{ margin: "0 0 10px", paddingLeft: 18 }}>
          <li>
            Modo:{" "}
            {result.transparency.appliedRules.mode === "quick"
              ? "automatico rapido"
              : "automatico revisado"}
          </li>
          <li>Interpretacao binaria: {result.transparency.appliedRules.binaryInterpretationMode}</li>
          <li>Overrides por pergunta: {result.transparency.appliedRules.questionOverrides}</li>
          <li>Pesos por secao: {result.transparency.appliedRules.sectionWeights}</li>
          <li>Observacao: {result.transparency.appliedRules.notes || "sem observacoes"}</li>
        </ul>
        {result.transparency.parsingWarnings.length > 0 && (
          <>
            <h4 style={{ marginBottom: 6 }}>Avisos de parsing</h4>
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {result.transparency.parsingWarnings.map((warning, idx) => (
                <li key={`${warning}-${idx}`}>{warning}</li>
              ))}
            </ul>
          </>
        )}
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Previa dos dados interpretados</h3>
        <div style={{ maxHeight: 320, overflow: "auto" }}>
          <table>
            <thead>
              <tr>
                {result.interpretedPreview.length > 0
                  ? Object.keys(result.interpretedPreview[0]).map((key) => <th key={key}>{key}</th>)
                  : null}
              </tr>
            </thead>
            <tbody>
              {result.interpretedPreview.map((row, idx) => (
                <tr key={idx}>
                  {Object.keys(row).map((key) => (
                    <td key={`${idx}-${key}`}>{String(row[key] ?? "")}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
