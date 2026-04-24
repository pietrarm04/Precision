"use client";

import { useMemo, useState } from "react";
import { AnalysisResult } from "@/lib/types";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type Props = {
  result: AnalysisResult;
  debugJson?: string | null;
  batchResults?: Array<{ fileName: string; result?: AnalysisResult; error?: string }> | null;
};

function qualityPill(score: number): { text: string; cls: string } {
  if (score < 0.5) return { text: "Estrutura fragil", cls: "pill danger" };
  if (score < 0.75) return { text: "Estrutura intermediaria", cls: "pill warn" };
  return { text: "Estrutura estavel", cls: "pill success" };
}

const LEVEL_COLOR: Record<string, string> = {
  baixo_risco: "#50d890",
  atencao: "#ffc857",
  possivel_multa: "#ff9966",
  possivel_interdicao: "#ff6b7a",
};
const DONUT_COLORS = ["#50d890", "#ff6b7a", "#ffc857"];

function NoData({ message }: { message: string }) {
  return <p className="muted small">{message}</p>;
}

export function ResultsView({ result, debugJson, batchResults }: Props) {
  const [activeTab, setActiveTab] = useState<"summary" | "dashboards">("summary");
  const q = qualityPill(result.structuralQuality.score);
  const sourceScore = result.sourceScore ?? result.qaAnalysis?.sourceScore;
  const computedIcs = result.qaAnalysis?.ics;
  const custom = result.customDashboards;
  const qa = result.qaAnalysis;

  const executiveCards = [
    {
      label: "Pontuação oficial",
      value: sourceScore
        ? `${sourceScore.score}/${sourceScore.totalScore} (${sourceScore.compliancePercentage.toFixed(1)}%)`
        : "Não disponível",
      emphasis: sourceScore ? "success" : "warning",
    },
    {
      label: "ICS calculado",
      value: computedIcs !== undefined ? `${computedIcs.toFixed(1)}%` : "Não disponível",
      emphasis:
        computedIcs === undefined ? "warning" : computedIcs >= 85 ? "success" : computedIcs >= 70 ? "warning" : "danger",
    },
    {
      label: "Total de itens",
      value: qa ? `${qa.totalItems}` : "0",
      emphasis: "default",
    },
    {
      label: "Conformes",
      value: qa ? `${qa.conformingAnswers}` : "0",
      emphasis: "success",
    },
    {
      label: "Não conformidades",
      value: qa ? `${qa.realFailures}` : "0",
      emphasis: qa && qa.realFailures > 0 ? "danger" : "success",
    },
    {
      label: "N/A",
      value: qa ? `${qa.notApplicable}` : "0",
      emphasis: "warning",
    },
  ] as const;

  const comparisonRows = useMemo(() => {
    if (!batchResults || batchResults.length <= 1) return [];
    return batchResults
      .filter((entry): entry is { fileName: string; result: AnalysisResult; error?: string } => Boolean(entry.result))
      .map((entry) => {
        const entryQa = entry.result.qaAnalysis;
        const entryScore = entry.result.sourceScore ?? entryQa?.sourceScore;
        return {
          fileName: entry.fileName,
          officialScore: entryScore
            ? `${entryScore.score}/${entryScore.totalScore} (${entryScore.compliancePercentage.toFixed(1)}%)`
            : "N/A",
          ics: entryQa?.ics ?? 0,
          conformes: entryQa?.conformingAnswers ?? 0,
          falhas: entryQa?.realFailures ?? 0,
          totalItems: entryQa?.totalItems ?? 0,
        };
      });
  }, [batchResults]);

  const bestIcs = comparisonRows.length > 0 ? Math.max(...comparisonRows.map((row) => row.ics)) : undefined;
  const worstIcs = comparisonRows.length > 0 ? Math.min(...comparisonRows.map((row) => row.ics)) : undefined;

  const sectionFailures = qa?.failuresBySection ?? [];
  const questionFailures = qa?.failuresByQuestion ?? [];
  const distributionData = [
    { label: "Conforme", value: qa?.conformingAnswers ?? 0 },
    { label: "Não conforme", value: qa?.realFailures ?? 0 },
    { label: "N/A", value: qa?.notApplicable ?? 0 },
  ];
  const icsByGroupWidget = custom?.sanitaryPerformance?.widgets.find((w) => w.id === "sanitary-ics-by-group");
  const icsByGroup = (icsByGroupWidget?.data ?? []).map((row) => ({
    grupo: String(row.grupo ?? row.group ?? "Não informado"),
    ics: Number(row.ics ?? 0),
  }));
  const riskRanking = custom?.risk?.ranking ?? [];
  const paretoData = questionFailures.map((entry, idx) => {
    const totalFailures = questionFailures.reduce((sum, qEntry) => sum + qEntry.total, 0);
    const accumulated =
      questionFailures.slice(0, idx + 1).reduce((sum, qEntry) => sum + qEntry.total, 0) / Math.max(totalFailures, 1);
    return {
      question: entry.question,
      failures: entry.total,
      cumulativePct: Number((accumulated * 100).toFixed(2)),
    };
  });

  return (
    <div className="grid dashboard-shell">
      <div className="card">
        <div className="dashboard-header">
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

      <div className="dashboard-tabs">
        <button
          type="button"
          className={`tab-btn ${activeTab === "summary" ? "active" : ""}`}
          onClick={() => setActiveTab("summary")}
        >
          Resumo numérico
        </button>
        <button
          type="button"
          className={`tab-btn ${activeTab === "dashboards" ? "active" : ""}`}
          onClick={() => setActiveTab("dashboards")}
        >
          Dashboards
        </button>
      </div>

      {activeTab === "summary" ? (
        <div className="grid" style={{ gap: 12 }}>
          <div className="kpi-grid">
            {executiveCards.map((card) => (
              <div key={card.label} className="card kpi-card">
                <div
                  className={`pill ${card.emphasis === "danger" ? "danger" : card.emphasis === "warning" ? "warn" : card.emphasis === "success" ? "success" : ""}`}
                >
                  {card.label}
                </div>
                <p className="big-value" style={{ marginTop: 10 }}>
                  {card.value}
                </p>
              </div>
            ))}
          </div>

          <div className="card">
            <h3 style={{ marginTop: 0, marginBottom: 8 }}>Alertas principais</h3>
            {result.alerts.length > 0 ? (
              <ul className="list" style={{ marginTop: 0 }}>
                {result.alerts.slice(0, 5).map((alert, idx) => (
                  <li key={`${alert}-${idx}`}>{alert}</li>
                ))}
              </ul>
            ) : (
              <NoData message="Sem alertas relevantes." />
            )}
          </div>

          {comparisonRows.length > 1 && (
            <div className="card">
              <h3 style={{ marginTop: 0, marginBottom: 8 }}>Comparação entre arquivos/unidades</h3>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Arquivo / Unidade</th>
                      <th>Pontuação oficial</th>
                      <th>ICS</th>
                      <th>Conformes</th>
                      <th>Não conformidades</th>
                      <th>Total de itens</th>
                    </tr>
                  </thead>
                  <tbody>
                    {comparisonRows.map((row) => {
                      const highlightClass =
                        row.ics === bestIcs ? "success-text" : row.ics === worstIcs ? "danger-text" : "";
                      return (
                        <tr key={row.fileName}>
                          <td className={highlightClass}>{row.fileName}</td>
                          <td>{row.officialScore}</td>
                          <td className={highlightClass}>{row.ics.toFixed(1)}%</td>
                          <td>{row.conformes}</td>
                          <td>{row.falhas}</td>
                          <td>{row.totalItems}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="small muted" style={{ margin: "10px 0 0" }}>
                Melhor unidade: <strong>{comparisonRows.find((row) => row.ics === bestIcs)?.fileName ?? "N/A"}</strong> | Pior unidade:{" "}
                <strong>{comparisonRows.find((row) => row.ics === worstIcs)?.fileName ?? "N/A"}</strong>
              </p>
            </div>
          )}

          <div className="card">
            <h3 style={{ marginTop: 0, marginBottom: 8 }}>Resumo executivo</h3>
            <p className="muted" style={{ margin: 0 }}>
              {result.summaryText}
            </p>
            {sourceScore && (
              <p className="small muted" style={{ margin: "8px 0 0" }}>
                A pontuação original pode diferir do ICS porque depende das regras de ponderação do template no sistema de origem.
              </p>
            )}
          </div>
        </div>
      ) : (
        <div className="grid" style={{ gap: 12 }}>
          <div className="kpi-grid">
            {executiveCards.slice(0, 4).map((card) => (
              <div key={`dash-${card.label}`} className="card kpi-card">
                <div
                  className={`pill ${card.emphasis === "danger" ? "danger" : card.emphasis === "warning" ? "warn" : card.emphasis === "success" ? "success" : ""}`}
                >
                  {card.label}
                </div>
                <p className="big-value" style={{ marginTop: 10 }}>
                  {card.value}
                </p>
              </div>
            ))}
          </div>

          <div className="dashboard-grid-2">
            <section className="card compact-chart">
              <h4 style={{ marginTop: 0 }}>Heatmap: Seção x falhas</h4>
              {sectionFailures.length > 0 ? (
                <div className="heatmap-strip">
                  {sectionFailures.map((entry) => {
                    const max = Math.max(...sectionFailures.map((s) => s.total), 1);
                    const intensity = entry.total / max;
                    return (
                      <div
                        key={entry.section}
                        className="heat-cell"
                        style={{ background: `rgba(255, 107, 122, ${0.2 + intensity * 0.75})` }}
                      >
                        <span>{entry.section}</span>
                        <strong>{entry.total}</strong>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <NoData message="Dados insuficientes para heatmap de seções." />
              )}
            </section>

            <section className="card compact-chart">
              <h4 style={{ marginTop: 0 }}>Heatmap: Unidade x risco</h4>
              {riskRanking.length > 0 ? (
                <div className="risk-heatmap">
                  {riskRanking.slice(0, 10).map((entry) => (
                    <div key={entry.group} className="risk-row">
                      <span className="risk-group">{entry.group}</span>
                      {["baixo_risco", "atencao", "possivel_multa", "possivel_interdicao"].map((level) => {
                        const active = entry.level === level;
                        return (
                          <span
                            key={`${entry.group}-${level}`}
                            className="risk-cell"
                            style={{
                              background: active ? LEVEL_COLOR[level] : "rgba(255,255,255,0.08)",
                              color: active ? "#081022" : "var(--muted)",
                            }}
                          >
                            {level.replaceAll("_", " ")}
                          </span>
                        );
                      })}
                    </div>
                  ))}
                </div>
              ) : (
                <NoData message="Dados insuficientes para heatmap de risco." />
              )}
            </section>
          </div>

          <div className="dashboard-grid-2">
            <section className="card compact-chart">
              <h4 style={{ marginTop: 0 }}>ICS por unidade (barra vertical)</h4>
              {icsByGroup.length > 0 ? (
                <div className="chart-box">
                  <ResponsiveContainer>
                    <BarChart data={icsByGroup}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#2b3765" />
                      <XAxis dataKey="grupo" stroke="#a4b2d8" />
                      <YAxis stroke="#a4b2d8" />
                      <Tooltip />
                      <Bar dataKey="ics" fill="#66b2ff" radius={[6, 6, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <NoData message="Dados insuficientes para comparação de ICS por unidade." />
              )}
            </section>

            <section className="card compact-chart">
              <h4 style={{ marginTop: 0 }}>Top seções com falhas (barra horizontal)</h4>
              {sectionFailures.length > 0 ? (
                <div className="chart-box">
                  <ResponsiveContainer>
                    <BarChart data={sectionFailures.slice(0, 8)} layout="vertical">
                      <CartesianGrid strokeDasharray="3 3" stroke="#2b3765" />
                      <XAxis type="number" stroke="#a4b2d8" />
                      <YAxis dataKey="section" type="category" width={130} stroke="#a4b2d8" />
                      <Tooltip />
                      <Bar dataKey="total" fill="#ff6b7a" radius={[0, 6, 6, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <NoData message="Dados insuficientes para ranking de seções." />
              )}
            </section>
          </div>

          <div className="dashboard-grid-2">
            <section className="card compact-chart">
              <h4 style={{ marginTop: 0 }}>Top perguntas com falhas (barra horizontal)</h4>
              {questionFailures.length > 0 ? (
                <div className="chart-box">
                  <ResponsiveContainer>
                    <BarChart data={questionFailures.slice(0, 10)} layout="vertical">
                      <CartesianGrid strokeDasharray="3 3" stroke="#2b3765" />
                      <XAxis type="number" stroke="#a4b2d8" />
                      <YAxis dataKey="question" type="category" width={160} stroke="#a4b2d8" />
                      <Tooltip />
                      <Bar dataKey="total" fill="#ff9966" radius={[0, 6, 6, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <NoData message="Dados insuficientes para ranking de perguntas." />
              )}
            </section>

            <section className="card compact-chart">
              <h4 style={{ marginTop: 0 }}>Distribuição (conforme / não conforme / N/A)</h4>
              {distributionData.some((entry) => entry.value > 0) ? (
                <div className="chart-box">
                  <ResponsiveContainer>
                    <PieChart>
                      <Pie data={distributionData} dataKey="value" nameKey="label" innerRadius={50} outerRadius={90} label>
                        {distributionData.map((entry, idx) => (
                          <Cell key={`${entry.label}-${idx}`} fill={DONUT_COLORS[idx % DONUT_COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip />
                      <Legend />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <NoData message="Dados insuficientes para distribuição de respostas." />
              )}
            </section>
          </div>

          <section className="card compact-chart">
            <h4 style={{ marginTop: 0 }}>Pareto de não conformidades</h4>
            {paretoData.length > 0 ? (
              <div className="chart-box">
                <ResponsiveContainer>
                  <ComposedChart data={paretoData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#2b3765" />
                    <XAxis dataKey="question" stroke="#a4b2d8" />
                    <YAxis yAxisId="left" stroke="#a4b2d8" />
                    <YAxis yAxisId="right" orientation="right" domain={[0, 100]} stroke="#a4b2d8" />
                    <Tooltip />
                    <Legend />
                    <Bar yAxisId="left" dataKey="failures" name="Falhas" fill="#ff6b7a" />
                    <Line yAxisId="right" type="monotone" dataKey="cumulativePct" name="% acumulado" stroke="#50d890" strokeWidth={3} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <NoData message="Dados insuficientes para gráfico de Pareto." />
            )}
          </section>
        </div>
      )}

      {debugJson && (
        <details className="card debug-accordion">
          <summary>Debug técnico</summary>
          <pre className="debug-json">{debugJson}</pre>
        </details>
      )}
    </div>
  );
}
