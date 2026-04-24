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

function riskLabel(level: "regular" | "atencao" | "risco_multa" | "risco_interdicao"): string {
  if (level === "risco_interdicao") return "Risco de interdição";
  if (level === "risco_multa") return "Risco de multa";
  if (level === "atencao") return "Atenção";
  return "Regular";
}

export function ResultsView({ result }: Props) {
  const q = qualityPill(result.structuralQuality.score);
  const sourceScore = result.sourceScore ?? result.qaAnalysis?.sourceScore;
  const custom = result.customDashboards;
  const multi = result.multiUnit;
  const isDebugMode = Boolean(result.debugMode);
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

      {custom?.kpiOverview && (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Dashboard de KPIs</h3>
          {custom.weightedComparison && (
            <div
              className="card"
              style={{
                padding: 12,
                marginBottom: 10,
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                gap: 8,
              }}
            >
              <div>
                <strong>ICS simples</strong>
                <div style={{ fontSize: 24, fontWeight: 700, marginTop: 4 }}>
                  {custom.weightedComparison.icsSimple.toFixed(1)}%
                </div>
              </div>
              <div>
                <strong>ICS ponderado</strong>
                <div style={{ fontSize: 24, fontWeight: 700, marginTop: 4 }}>
                  {custom.weightedComparison.icsWeighted.toFixed(1)}%
                </div>
              </div>
              <div>
                <strong>Score de risco ponderado</strong>
                <div style={{ fontSize: 24, fontWeight: 700, marginTop: 4 }}>
                  {custom.weightedComparison.weightedRiskScore.toFixed(2)}
                </div>
              </div>
              <div>
                <strong>Peso médio das falhas</strong>
                <div style={{ fontSize: 24, fontWeight: 700, marginTop: 4 }}>
                  {custom.weightedComparison.averageFailureWeight.toFixed(2)}
                </div>
              </div>
            </div>
          )}
          {custom.weightTransparency && (
            <p style={{ marginTop: 0, color: "var(--muted)" }}>{custom.weightTransparency.message}</p>
          )}
          {custom.kpiOverview.cards.length > 0 ? (
            <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
              {custom.kpiOverview.cards.map((card) => {
                const cls =
                  card.status === "atingido" ? "pill success" : card.status === "atencao" ? "pill warn" : "pill danger";
                return (
                  <div key={card.key} className="card" style={{ padding: 12 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
                      <strong>{card.label}</strong>
                      <span className={cls}>{card.status}</span>
                    </div>
                    <div style={{ fontSize: 24, fontWeight: 700, marginTop: 8 }}>{card.currentValueLabel}</div>
                    <div style={{ color: "var(--muted)", fontSize: 13, marginTop: 4 }}>
                      Meta: {card.targetValueLabel ?? "não definida"}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p style={{ margin: 0, color: "var(--muted)" }}>
              {custom.kpiOverview.missingMessage ?? "Dados insuficientes para KPI overview."}
            </p>
          )}
        </div>
      )}

      {custom?.sanitaryPerformance && (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Dashboard de performance sanitária</h3>
          {custom.sanitaryPerformance.widgets.length > 0 ? (
            <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 10 }}>
              {custom.sanitaryPerformance.widgets.map((widget) => (
                <ChartRenderer key={widget.id} widget={widget} />
              ))}
            </div>
          ) : (
            <p style={{ margin: 0, color: "var(--muted)" }}>
              {custom.sanitaryPerformance.missingMessage ??
                "Dados insuficientes para montar gráficos sanitários confiáveis."}
            </p>
          )}
        </div>
      )}

      {custom?.risk && (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Painel de risco sanitário</h3>
          <p style={{ marginTop: 0, color: "var(--muted)" }}>
            Classificação indicativa operacional de risco (não substitui decisão legal ou regulatória).
          </p>
          {custom.risk.ranking.length > 0 ? (
            <>
              <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 10 }}>
                {custom.risk.counts.map((item) => (
                  <div key={item.level} className="card" style={{ padding: 12 }}>
                    <strong>{item.label}</strong>
                    <div style={{ fontSize: 24, fontWeight: 700, marginTop: 6 }}>{item.count}</div>
                  </div>
                ))}
              </div>
              <div style={{ marginTop: 12, maxHeight: 260, overflow: "auto" }}>
                <table>
                  <thead>
                    <tr>
                      <th>Grupo</th>
                      <th>Nível de risco</th>
                      <th>ICS simples</th>
                      <th>ICS ponderado</th>
                      <th>Falhas simples</th>
                      <th>Falhas ponderadas</th>
                      <th>Peso médio</th>
                      <th>Score risco</th>
                      <th>Críticas</th>
                    </tr>
                  </thead>
                  <tbody>
                    {custom.risk.ranking.slice(0, 20).map((item) => (
                      <tr key={`${item.group}-${item.level}`}>
                        <td>{item.group}</td>
                        <td>{item.level.replaceAll("_", " ")}</td>
                        <td>{item.icsSimple.toFixed(2)}%</td>
                        <td>{item.icsWeighted.toFixed(2)}%</td>
                        <td>{item.simpleFailures}</td>
                        <td>{item.weightedFailures.toFixed(2)}</td>
                        <td>{item.averageWeight.toFixed(2)}</td>
                        <td>{item.weightedRiskScore.toFixed(2)}</td>
                        <td>{item.criticalCount}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <p style={{ margin: 0, color: "var(--muted)" }}>
              {custom.risk.missingMessage ?? "Sem dados suficientes para painel de risco."}
            </p>
          )}
        </div>
      )}

      {custom?.pareto && (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Pontos críticos (Pareto)</h3>
          {custom.pareto.highlights.length > 0 && (
            <ul style={{ margin: "0 0 10px", paddingLeft: 18, color: "var(--muted)" }}>
              {custom.pareto.highlights.map((item, idx) => (
                <li key={`${item.dimensao}-${idx}`}>{item.resumo}</li>
              ))}
            </ul>
          )}
          {custom.pareto.widgets.length > 0 ? (
            <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 10 }}>
              {custom.pareto.widgets.map((widget) => (
                <ChartRenderer key={widget.id} widget={widget} />
              ))}
            </div>
          ) : (
            <p style={{ margin: 0, color: "var(--muted)" }}>
              {custom.pareto.missingMessage ?? "Sem dados suficientes para análise de Pareto."}
            </p>
          )}
        </div>
      )}

      {custom?.okr && (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Dashboard de OKRs</h3>
          {custom.okr.objectives.length > 0 ? (
            <div className="grid" style={{ gap: 10 }}>
              {custom.okr.objectives.map((objective) => (
                <div key={objective.objectiveTitle} className="card" style={{ padding: 12 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
                    <strong>{objective.objectiveTitle}</strong>
                    <span
                      className={
                        objective.status === "atingido"
                          ? "pill success"
                          : objective.status === "atencao"
                            ? "pill warn"
                            : "pill danger"
                      }
                    >
                      {objective.status}
                    </span>
                  </div>
                  <div style={{ marginTop: 8, color: "var(--muted)" }}>
                    Progresso do objetivo: {objective.progressPercentage.toFixed(1)}%
                  </div>
                  <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
                    {objective.keyResults.map((kr) => (
                      <div key={`${objective.objectiveTitle}-${kr.title}`} className="card" style={{ padding: 10 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                          <span>{kr.title}</span>
                          <span
                            className={
                              kr.status === "atingido"
                                ? "pill success"
                                : kr.status === "atencao"
                                  ? "pill warn"
                                  : "pill danger"
                            }
                          >
                            {kr.status}
                          </span>
                        </div>
                        <div
                          style={{
                            marginTop: 6,
                            height: 8,
                            borderRadius: 999,
                            background: "rgba(255,255,255,0.14)",
                            overflow: "hidden",
                          }}
                        >
                          <div
                            style={{
                              width: `${Math.min(100, Math.max(0, kr.progressPercentage))}%`,
                              height: "100%",
                              background:
                                kr.status === "atingido"
                                  ? "var(--success)"
                                  : kr.status === "atencao"
                                    ? "var(--warning)"
                                    : "var(--danger)",
                            }}
                          />
                        </div>
                        <div style={{ marginTop: 6, fontSize: 13, color: "var(--muted)" }}>
                          Atual: {kr.currentValue} | Meta: {kr.targetValue} | Progresso: {kr.progressPercentage.toFixed(1)}%
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p style={{ margin: 0, color: "var(--muted)" }}>
              {custom.okr.missingMessage ?? "Nenhum OKR disponível para visualização."}
            </p>
          )}
        </div>
      )}

      {multi && (
        <div className="card" style={{ display: "grid", gap: 12 }}>
          <h3 style={{ marginTop: 0, marginBottom: 0 }}>Comparação multi-unidade</h3>
          <p style={{ margin: 0, color: "var(--muted)" }}>
            {multi.comparedFiles} de {multi.totalFiles} arquivo(s) comparado(s), agrupamento por{" "}
            <strong>{multi.grouping}</strong>.
          </p>

          <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
            <div className="card" style={{ padding: 12 }}>
              <strong>Melhor unidade</strong>
              <div style={{ marginTop: 6, color: "var(--success)", fontWeight: 700 }}>
                {multi.bestWorst.bestUnit ?? "N/A"}
              </div>
            </div>
            <div className="card" style={{ padding: 12 }}>
              <strong>Pior unidade</strong>
              <div style={{ marginTop: 6, color: "var(--danger)", fontWeight: 700 }}>
                {multi.bestWorst.worstUnit ?? "N/A"}
              </div>
            </div>
            <div className="card" style={{ padding: 12 }}>
              <strong>Maior risco</strong>
              <div style={{ marginTop: 6, fontWeight: 700 }}>{multi.bestWorst.highestRiskUnit ?? "N/A"}</div>
            </div>
            <div className="card" style={{ padding: 12 }}>
              <strong>Maior variação</strong>
              <div style={{ marginTop: 6, fontWeight: 700 }}>
                {multi.bestWorst.highestVariationUnit ?? "N/A"} ({multi.bestWorst.icsWeightedStdDev.toFixed(2)} dp)
              </div>
            </div>
          </div>

          <div style={{ maxHeight: 320, overflow: "auto" }}>
            <table>
              <thead>
                <tr>
                  <th>Unidade</th>
                  <th>ICS</th>
                  <th>ICS ponderado</th>
                  <th>Falhas totais</th>
                  <th>Falhas gravíssimas</th>
                  <th>Risco</th>
                </tr>
              </thead>
              <tbody>
                {multi.comparisonTable.map((row) => {
                  const isBest = row.unitName === multi.bestWorst.bestUnit;
                  const isWorst = row.unitName === multi.bestWorst.worstUnit;
                  return (
                    <tr
                      key={`${row.unitId}-comparison`}
                      style={{
                        background: isBest
                          ? "rgba(80, 216, 144, 0.12)"
                          : isWorst
                            ? "rgba(255, 107, 122, 0.12)"
                            : "transparent",
                      }}
                    >
                      <td>{row.unitName}</td>
                      <td>{row.icsSimple.toFixed(2)}%</td>
                      <td>{row.icsWeighted.toFixed(2)}%</td>
                      <td>{row.totalFailures}</td>
                      <td>{row.criticalFailures}</td>
                      <td>{riskLabel(row.riskLevel)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div style={{ maxHeight: 260, overflow: "auto" }}>
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Ranking geral</th>
                  <th>Score risco</th>
                  <th>Falhas ponderadas</th>
                  <th>ICS ponderado</th>
                  <th>Gravíssimas</th>
                </tr>
              </thead>
              <tbody>
                {multi.ranking.map((row, idx) => (
                  <tr key={`${row.unitId}-ranking`}>
                    <td>{idx + 1}</td>
                    <td>{row.unitName}</td>
                    <td>{row.weightedRiskScore.toFixed(2)}</td>
                    <td>{row.weightedFailures.toFixed(2)}</td>
                    <td>{row.icsWeighted.toFixed(2)}%</td>
                    <td>{row.criticalFailures}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {multi.widgets.length > 0 && (
            <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 10 }}>
              {multi.widgets.map((widget) => (
                <ChartRenderer key={widget.id} widget={widget} />
              ))}
            </div>
          )}

          {multi.insights.length > 0 && (
            <div className="card" style={{ padding: 12 }}>
              <strong>Insights comparativos</strong>
              <ul style={{ margin: "8px 0 0", paddingLeft: 18 }}>
                {multi.insights.map((insight, idx) => (
                  <li key={`${insight}-${idx}`}>{insight}</li>
                ))}
              </ul>
            </div>
          )}

          {multi.errors.length > 0 && (
            <div className="card" style={{ padding: 12 }}>
              <strong>Arquivos com falha de processamento parcial</strong>
              <ul style={{ margin: "8px 0 0", paddingLeft: 18 }}>
                {multi.errors.map((item, idx) => (
                  <li key={`${item.fileName}-${idx}`}>
                    {item.unitLabel ?? item.fileName}: {item.message}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

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
        {isDebugMode && result.transparency.parsingWarnings.length > 0 && (
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
