"use client";

import { useEffect, useMemo, useState } from "react";
import { RuleReviewPanel } from "@/components/RuleReviewPanel";
import { ResultsView } from "@/components/ResultsView";
import {
  AnalysisResult,
  DashboardCustomizationConfig,
  KpiKey,
  ManualQuestionOverride,
  ManualReviewConfig,
  OkrInput,
} from "@/lib/types";

async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const data = String(reader.result ?? "");
      const split = data.split(",");
      resolve(split[1] ?? "");
    };
    reader.onerror = () => reject(new Error("Falha ao ler arquivo."));
    reader.readAsDataURL(file);
  });
}

function assertValidFile(file: File | null): file is File {
  return isValidTabularFile(file);
}
function createDefaultRules(result: AnalysisResult): ManualReviewConfig {
  return {
    mode: "reviewed",
    binaryInterpretationMode: "auto",
    questionOverrides: (result.qaAnalysis?.ambiguousQuestions ?? []).map((item: ManualQuestionOverride) => item),
    sectionWeights: [],
    notes: "",
  };
}

function isValidTabularFile(file: File | null): boolean {
  if (!file) {
    return false;
  }
  return /\.(csv|xlsx|xls)$/i.test(file.name);
}

function appendClientDebugLog(payload: {
  hypothesisId: string;
  location: string;
  message: string;
  data: Record<string, unknown>;
  timestamp: number;
}) {
  // #region agent log
  void fetch("/api/debug-log", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }).catch(() => {});
  // #endregion
}

const KPI_OPTIONS: Array<{ key: KpiKey; label: string }> = [
  { key: "ics_medio", label: "ICS médio" },
  { key: "ics_minimo", label: "ICS mínimo" },
  { key: "ics_maximo", label: "ICS máximo" },
  { key: "desvio_padrao_ics", label: "Desvio padrão do ICS" },
  { key: "total_nao_conformidades", label: "Total de não conformidades" },
  { key: "nao_conformidades_criticas", label: "Não conformidades críticas" },
  { key: "percentual_nao_conformidade", label: "% de não conformidade" },
  { key: "percentual_nao_aplicavel", label: "% de não aplicável" },
  { key: "score_medio", label: "Score médio" },
  { key: "quantidade_inspecoes", label: "Quantidade de inspeções" },
];

function createDefaultDashboardConfig(): DashboardCustomizationConfig {
  return {
    selectedKpis: KPI_OPTIONS.map((item) => item.key),
    grouping: "loja",
    primaryIcsMetric: "ponderado",
    kpiTargets: {},
    questionWeights: [],
    sectionWeights: [],
    themeWeights: [],
    visibleSections: {
      kpiOverview: true,
      sanitaryPerformance: true,
      okr: true,
      risk: true,
      pareto: true,
    },
    okrs: [],
  };
}

export default function HomePage() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [quickMode, setQuickMode] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [debugJson, setDebugJson] = useState<string | null>(null);
  const [rules, setRules] = useState<ManualReviewConfig | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryText, setSummaryText] = useState<string | null>(null);
  const [sampleFiles, setSampleFiles] = useState<string[]>([]);
  const [selectedSample, setSelectedSample] = useState<string>("");
  const [sampleLoading, setSampleLoading] = useState(false);
  const [dashboardConfig, setDashboardConfig] = useState<DashboardCustomizationConfig>(
    createDefaultDashboardConfig(),
  );

  const fileInfo = useMemo(() => {
    if (!selectedFile) {
      return null;
    }
    return `${selectedFile.name} · ${(selectedFile.size / 1024).toFixed(1)} KB`;
  }, [selectedFile]);

  async function runAnalysis(mode: "quick" | "reviewed", reviewRules?: ManualReviewConfig) {
    // #region agent log
    appendClientDebugLog({
      hypothesisId: "C",
      location: "app/page.tsx:runAnalysis-entry",
      message: "runAnalysis invoked",
      data: {
        mode,
        hasSelectedFile: Boolean(selectedFile),
        loading,
      },
      timestamp: Date.now(),
    });
    // #endregion
    if (!assertValidFile(selectedFile)) {
      // #region agent log
      appendClientDebugLog({
        hypothesisId: "C",
        location: "app/page.tsx:runAnalysis-no-file-branch",
        message: "runAnalysis exited without selected file",
        data: { mode, loading },
        timestamp: Date.now(),
      });
      // #endregion
      setError("Selecione um arquivo CSV, XLSX ou XLS antes de iniciar a analise.");
      return;
    }
    setLoading(true);
    setError(null);
    setDebugJson(null);
    try {
      const fileBase64 = await fileToBase64(selectedFile);
      // #region agent log
      appendClientDebugLog({
        hypothesisId: "C",
        location: "app/page.tsx:runAnalysis-before-fetch",
        message: "Prepared payload for /api/analyze",
        data: {
          mode,
          fileSize: selectedFile.size,
          fileType: selectedFile.type || "unknown",
          base64Length: fileBase64.length,
        },
        timestamp: Date.now(),
      });
      // #endregion
      const payload = {
        fileName: selectedFile.name,
        fileBase64,
        mode,
        rules: reviewRules,
        dashboardConfig,
        debugMode: false,
      };
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await response.json()) as AnalysisResult & { error?: string; message?: string };
      if (!response.ok) {
        throw new Error(data.error ?? data.message ?? "Erro ao processar arquivo.");
      }
      setResult(data);
      setDebugJson(JSON.stringify(data, null, 2));
      if (mode === "reviewed") {
        setRules(reviewRules ?? createDefaultRules(data));
      }
    } catch (analysisError) {
      setResult(null);
      setDebugJson(null);
      setError(
        analysisError instanceof Error
          ? analysisError.message
          : "Nao foi possivel concluir a analise.",
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // #region agent log
    appendClientDebugLog({
      hypothesisId: "A",
      location: "app/page.tsx:state-effect",
      message: "State snapshot updated",
      data: {
        hasSelectedFile: Boolean(selectedFile),
        selectedFileSize: selectedFile?.size ?? null,
        loading,
        derivedDisabled: !selectedFile || loading,
      },
      timestamp: Date.now(),
    });
    // #endregion
  }, [selectedFile, loading, dashboardConfig]);

  useEffect(() => {
    async function loadSampleFiles() {
      try {
        const response = await fetch("/api/sample-files");
        if (!response.ok) {
          return;
        }
        const data = (await response.json()) as { files?: string[] };
        const files = data.files ?? [];
        setSampleFiles(files);
        if (files.length > 0) {
          setSelectedSample(files[0]);
        }
      } catch {
        // Intencionalmente silencioso: o uploader local continua funcionando.
      }
    }
    void loadSampleFiles();
  }, []);

  function decodeBase64(base64: string): ArrayBuffer {
    const binary = atob(base64);
    const buffer = new ArrayBuffer(binary.length);
    const bytes = new Uint8Array(buffer);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return buffer;
  }

  async function loadSampleFile() {
    if (!selectedSample) {
      return;
    }
    setSampleLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/sample-files?name=${encodeURIComponent(selectedSample)}`);
      const data = (await response.json()) as {
        fileName?: string;
        fileBase64?: string;
        mimeType?: string;
        message?: string;
      };
      if (!response.ok || !data.fileName || !data.fileBase64) {
        throw new Error(data.message ?? "Falha ao carregar arquivo de exemplo.");
      }
      const file = new File([decodeBase64(data.fileBase64)], data.fileName, {
        type: data.mimeType ?? "application/octet-stream",
      });
      setSelectedFile(file);
      setResult(null);
      setRules(null);
      setSummaryText(null);
    } catch (sampleError) {
      setError(sampleError instanceof Error ? sampleError.message : "Falha ao carregar exemplo.");
    } finally {
      setSampleLoading(false);
    }
  }

  async function exportSummary() {
    if (!result) {
      return;
    }
    setSummaryLoading(true);
    try {
      const response = await fetch("/api/export-summary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(result),
      });
      const data = (await response.json()) as { text: string };
      if (!response.ok) {
        throw new Error("Falha ao gerar resumo para exportacao.");
      }
      setSummaryText(data.text);
    } catch (summaryError) {
      setError(summaryError instanceof Error ? summaryError.message : "Erro ao exportar resumo.");
    } finally {
      setSummaryLoading(false);
    }
  }

  return (
    <main className="container grid" style={{ gap: 22, paddingBottom: 36 }}>
      <section className="card" style={{ padding: 26 }}>
        <span className="pill">Analista automatico de planilhas e CSVs</span>
        <h1 style={{ marginTop: 14, marginBottom: 10, fontSize: 34 }}>
          Transforme dados tabulares baguncados em analise clara e acionavel.
        </h1>
        <p style={{ margin: 0, color: "var(--muted)", maxWidth: 900, lineHeight: 1.5 }}>
          Envie CSV, XLSX ou XLS. O sistema interpreta estrutura, normaliza, infere o tipo do
          dataset, gera dashboards dinamicos, insights e alertas. Em datasets de checklist/inspecao
          voce pode revisar regras semanticas e pesos antes da analise final.
        </p>
      </section>

      <section className="card grid" style={{ gap: 14 }}>
        <h2 style={{ margin: 0 }}>1) Upload e modo de analise</h2>
        <p style={{ marginTop: 0, color: "var(--muted)" }}>
          Recomendado: comecar em analise rapida e depois revisar regras se o arquivo for de
          inspecao.
        </p>
        <input
          type="file"
          accept=".csv,.xlsx,.xls"
          onChange={(event) => {
            const files = event.currentTarget.files;
            const file = files?.[0] ?? null;
            // #region agent log
            appendClientDebugLog({
              hypothesisId: "B",
              location: "app/page.tsx:file-input-onChange",
              message: "File input changed",
              data: {
                fileCount: files?.length ?? 0,
                selectedFileSize: file?.size ?? null,
                selectedFileType: file?.type ?? "none",
              },
              timestamp: Date.now(),
            });
            // #endregion
            if (!file) {
              setError(
                "Nenhum arquivo foi selecionado. Se estiver em ambiente remoto, escolha um arquivo local do computador ou use o carregamento de exemplo.",
              );
              return;
            }
            if (file && !isValidTabularFile(file)) {
              setSelectedFile(null);
              setError("Arquivo invalido. Envie apenas CSV, XLSX ou XLS.");
              return;
            }
            setSelectedFile(file);
            setResult(null);
            setDebugJson(null);
            setRules(null);
            setSummaryText(null);
            setDashboardConfig(createDefaultDashboardConfig());
            setError(null);
          }}
        />
        <p style={{ margin: 0, color: "var(--muted)", fontSize: 13 }}>
          Se o seletor de arquivos nao conseguir abrir caminhos como <code>/workspace/... </code>, use
          um arquivo local do navegador ou o carregador de exemplos abaixo.
        </p>
        {sampleFiles.length > 0 && (
          <div className="card" style={{ padding: 12 }}>
            <div style={{ display: "grid", gap: 8 }}>
              <strong>Carregar arquivo de exemplo do servidor</strong>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <select
                  value={selectedSample}
                  onChange={(event) => setSelectedSample(event.target.value)}
                  style={{ minWidth: 240, width: "auto", flex: "1 1 240px" }}
                >
                  {sampleFiles.map((sampleFile) => (
                    <option key={sampleFile} value={sampleFile}>
                      {sampleFile}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="btn secondary"
                  onClick={() => void loadSampleFile()}
                  disabled={sampleLoading || loading}
                >
                  {sampleLoading ? "Carregando exemplo..." : "Carregar exemplo"}
                </button>
              </div>
            </div>
          </div>
        )}
        {fileInfo && <div style={{ color: "var(--muted)" }}>{fileInfo}</div>}
        <div className="grid" style={{ gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <label className="card" style={{ padding: 12 }}>
            <input
              type="radio"
              name="mode"
              checked={quickMode}
              onChange={() => setQuickMode(true)}
              style={{ width: "auto", marginRight: 8 }}
            />
            Analise rapida (heuristica automatica)
          </label>
          <label className="card" style={{ padding: 12 }}>
            <input
              type="radio"
              name="mode"
              checked={!quickMode}
              onChange={() => setQuickMode(false)}
              style={{ width: "auto", marginRight: 8 }}
            />
            Analise revisada (com ajuste de regras)
          </label>
        </div>
        <div className="card" style={{ padding: 14, display: "grid", gap: 12 }}>
          <h3 style={{ margin: 0 }}>2) Personalização de KPI e OKR</h3>
          <p style={{ margin: 0, color: "var(--muted)" }}>
            Escolha os KPIs, agrupamento, metas e seções visíveis para o dashboard executivo.
          </p>
          <label>
            <span>Agrupar por</span>
            <select
              value={dashboardConfig.grouping}
              onChange={(event) =>
                setDashboardConfig((prev) => ({
                  ...prev,
                  grouping: event.target.value as DashboardCustomizationConfig["grouping"],
                }))
              }
            >
              <option value="loja">Loja</option>
              <option value="setor">Setor</option>
              <option value="template">Template</option>
              <option value="periodo">Período</option>
            </select>
          </label>
          <label>
            <span>Métrica prioritária de ICS</span>
            <select
              value={dashboardConfig.primaryIcsMetric ?? "ponderado"}
              onChange={(event) =>
                setDashboardConfig((prev) => ({
                  ...prev,
                  primaryIcsMetric: event.target.value as "simples" | "ponderado",
                }))
              }
            >
              <option value="ponderado">ICS ponderado por risco</option>
              <option value="simples">ICS simples</option>
            </select>
          </label>
          <div style={{ display: "grid", gap: 8 }}>
            <strong>KPIs exibidos</strong>
            <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 8 }}>
              {KPI_OPTIONS.map((option) => {
                const checked = dashboardConfig.selectedKpis.includes(option.key);
                return (
                  <label key={option.key} className="card" style={{ padding: 10 }}>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(event) => {
                        const enable = event.target.checked;
                        setDashboardConfig((prev) => {
                          const current = new Set(prev.selectedKpis);
                          if (enable) current.add(option.key);
                          else current.delete(option.key);
                          return {
                            ...prev,
                            selectedKpis: KPI_OPTIONS.map((item) => item.key).filter((key) => current.has(key)),
                          };
                        });
                      }}
                      style={{ width: "auto", marginRight: 8 }}
                    />
                    {option.label}
                  </label>
                );
              })}
            </div>
          </div>
          <div style={{ display: "grid", gap: 8 }}>
            <strong>Metas (targets) por KPI</strong>
            <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 8 }}>
              {KPI_OPTIONS.map((option) => (
                <label key={`target-${option.key}`}>
                  <span>{option.label}</span>
                  <input
                    type="number"
                    placeholder="Sem meta"
                    value={dashboardConfig.kpiTargets?.[option.key] ?? ""}
                    onChange={(event) => {
                      const raw = event.target.value.trim();
                      setDashboardConfig((prev) => {
                        const nextTargets = { ...(prev.kpiTargets ?? {}) };
                        if (!raw) {
                          delete nextTargets[option.key];
                        } else {
                          const numeric = Number(raw);
                          if (Number.isFinite(numeric)) {
                            nextTargets[option.key] = numeric;
                          }
                        }
                        return { ...prev, kpiTargets: nextTargets };
                      });
                    }}
                  />
                </label>
              ))}
            </div>
          </div>
          <div className="card" style={{ padding: 12, display: "grid", gap: 8 }}>
            <strong>Pesos por seção (1 = leve, 2 = grave, 3 = gravíssimo)</strong>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                type="button"
                className="btn secondary"
                onClick={() =>
                  setDashboardConfig((prev) => ({
                    ...prev,
                    sectionWeights: [...(prev.sectionWeights ?? []), { section: "Nova seção", weight: 1 }],
                  }))
                }
              >
                Adicionar seção
              </button>
            </div>
            {(dashboardConfig.sectionWeights ?? []).map((item, idx) => (
              <div
                key={`section-weight-${idx}`}
                style={{ display: "grid", gridTemplateColumns: "2fr 1fr auto", gap: 8, alignItems: "end" }}
              >
                <label>
                  <span>Seção</span>
                  <input
                    type="text"
                    value={item.section}
                    onChange={(event) => {
                      const value = event.target.value;
                      setDashboardConfig((prev) => {
                        const next = [...(prev.sectionWeights ?? [])];
                        next[idx] = { ...next[idx], section: value };
                        return { ...prev, sectionWeights: next };
                      });
                    }}
                  />
                </label>
                <label>
                  <span>Peso</span>
                  <input
                    type="number"
                    min={1}
                    max={3}
                    value={item.weight}
                    onChange={(event) => {
                      const numeric = Number(event.target.value);
                      setDashboardConfig((prev) => {
                        const next = [...(prev.sectionWeights ?? [])];
                        next[idx] = {
                          ...next[idx],
                          weight: Number.isFinite(numeric) ? Math.max(1, Math.min(3, numeric)) : 1,
                        };
                        return { ...prev, sectionWeights: next };
                      });
                    }}
                  />
                </label>
                <button
                  type="button"
                  className="btn secondary"
                  onClick={() =>
                    setDashboardConfig((prev) => {
                      const next = [...(prev.sectionWeights ?? [])];
                      next.splice(idx, 1);
                      return { ...prev, sectionWeights: next };
                    })
                  }
                >
                  Remover
                </button>
              </div>
            ))}
          </div>
          <div className="card" style={{ padding: 12, display: "grid", gap: 8 }}>
            <strong>Pesos por tema/categoria (1 = leve, 2 = grave, 3 = gravíssimo)</strong>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                type="button"
                className="btn secondary"
                onClick={() =>
                  setDashboardConfig((prev) => ({
                    ...prev,
                    themeWeights: [...(prev.themeWeights ?? []), { theme: "Novo tema", weight: 1 }],
                  }))
                }
              >
                Adicionar tema
              </button>
            </div>
            {(dashboardConfig.themeWeights ?? []).map((item, idx) => (
              <div
                key={`theme-weight-${idx}`}
                style={{ display: "grid", gridTemplateColumns: "2fr 1fr auto", gap: 8, alignItems: "end" }}
              >
                <label>
                  <span>Tema</span>
                  <input
                    type="text"
                    value={item.theme}
                    onChange={(event) => {
                      const value = event.target.value;
                      setDashboardConfig((prev) => {
                        const next = [...(prev.themeWeights ?? [])];
                        next[idx] = { ...next[idx], theme: value };
                        return { ...prev, themeWeights: next };
                      });
                    }}
                  />
                </label>
                <label>
                  <span>Peso</span>
                  <input
                    type="number"
                    min={1}
                    max={3}
                    value={item.weight}
                    onChange={(event) => {
                      const numeric = Number(event.target.value);
                      setDashboardConfig((prev) => {
                        const next = [...(prev.themeWeights ?? [])];
                        next[idx] = {
                          ...next[idx],
                          weight: Number.isFinite(numeric) ? Math.max(1, Math.min(3, numeric)) : 1,
                        };
                        return { ...prev, themeWeights: next };
                      });
                    }}
                  />
                </label>
                <button
                  type="button"
                  className="btn secondary"
                  onClick={() =>
                    setDashboardConfig((prev) => {
                      const next = [...(prev.themeWeights ?? [])];
                      next.splice(idx, 1);
                      return { ...prev, themeWeights: next };
                    })
                  }
                >
                  Remover
                </button>
              </div>
            ))}
          </div>
          <div className="card" style={{ padding: 12, display: "grid", gap: 8 }}>
            <strong>Pesos por pergunta (1 = leve, 2 = grave, 3 = gravíssimo)</strong>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                type="button"
                className="btn secondary"
                onClick={() =>
                  setDashboardConfig((prev) => ({
                    ...prev,
                    questionWeights: [...(prev.questionWeights ?? []), { questionText: "Nova pergunta", weight: 1 }],
                  }))
                }
              >
                Adicionar pergunta
              </button>
            </div>
            {(dashboardConfig.questionWeights ?? []).map((item, idx) => (
              <div
                key={`question-weight-${idx}`}
                style={{ display: "grid", gridTemplateColumns: "2fr 1fr auto", gap: 8, alignItems: "end" }}
              >
                <label>
                  <span>Pergunta</span>
                  <input
                    type="text"
                    value={item.questionText}
                    onChange={(event) => {
                      const value = event.target.value;
                      setDashboardConfig((prev) => {
                        const next = [...(prev.questionWeights ?? [])];
                        next[idx] = { ...next[idx], questionText: value };
                        return { ...prev, questionWeights: next };
                      });
                    }}
                  />
                </label>
                <label>
                  <span>Peso</span>
                  <input
                    type="number"
                    min={1}
                    max={3}
                    value={item.weight}
                    onChange={(event) => {
                      const numeric = Number(event.target.value);
                      setDashboardConfig((prev) => {
                        const next = [...(prev.questionWeights ?? [])];
                        next[idx] = {
                          ...next[idx],
                          weight: Number.isFinite(numeric) ? Math.max(1, Math.min(3, numeric)) : 1,
                        };
                        return { ...prev, questionWeights: next };
                      });
                    }}
                  />
                </label>
                <button
                  type="button"
                  className="btn secondary"
                  onClick={() =>
                    setDashboardConfig((prev) => {
                      const next = [...(prev.questionWeights ?? [])];
                      next.splice(idx, 1);
                      return { ...prev, questionWeights: next };
                    })
                  }
                >
                  Remover
                </button>
              </div>
            ))}
          </div>
          <div style={{ display: "grid", gap: 8 }}>
            <strong>Seções visíveis</strong>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              {[
                ["kpiOverview", "Visão KPI"],
                ["sanitaryPerformance", "Performance sanitária"],
                ["okr", "OKR"],
                ["risk", "Risco"],
                ["pareto", "Pontos críticos (Pareto)"],
              ].map(([key, label]) => (
                <label key={key} className="card" style={{ padding: 10 }}>
                  <input
                    type="checkbox"
                    checked={dashboardConfig.visibleSections?.[key as keyof NonNullable<DashboardCustomizationConfig["visibleSections"]>] ?? true}
                    onChange={(event) =>
                      setDashboardConfig((prev) => ({
                        ...prev,
                        visibleSections: {
                          ...(prev.visibleSections ?? {
                            kpiOverview: true,
                            sanitaryPerformance: true,
                            okr: true,
                            risk: true,
                            pareto: true,
                          }),
                          [key]: event.target.checked,
                        },
                      }))
                    }
                    style={{ width: "auto", marginRight: 8 }}
                  />
                  {label}
                </label>
              ))}
            </div>
          </div>
          <div className="card" style={{ padding: 12, display: "grid", gap: 8 }}>
            <strong>OKR (objetivo + resultados-chave)</strong>
            {(dashboardConfig.okrs ?? []).map((okr, okrIdx) => (
              <div key={`okr-${okrIdx}`} className="card" style={{ padding: 10, display: "grid", gap: 8 }}>
                <label>
                  <span>Título do objetivo</span>
                  <input
                    type="text"
                    value={okr.objectiveTitle}
                    onChange={(event) => {
                      const value = event.target.value;
                      setDashboardConfig((prev) => {
                        const next = [...(prev.okrs ?? [])];
                        next[okrIdx] = { ...next[okrIdx], objectiveTitle: value };
                        return { ...prev, okrs: next };
                      });
                    }}
                  />
                </label>
                {(okr.keyResults ?? []).map((kr, krIdx) => (
                  <div
                    key={`okr-${okrIdx}-kr-${krIdx}`}
                    style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr auto", gap: 8, alignItems: "end" }}
                  >
                    <label>
                      <span>Key Result</span>
                      <input
                        type="text"
                        value={kr.title}
                        onChange={(event) => {
                          const value = event.target.value;
                          setDashboardConfig((prev) => {
                            const next = [...(prev.okrs ?? [])];
                            const nextKrs = [...next[okrIdx].keyResults];
                            nextKrs[krIdx] = { ...nextKrs[krIdx], title: value };
                            next[okrIdx] = { ...next[okrIdx], keyResults: nextKrs };
                            return { ...prev, okrs: next };
                          });
                        }}
                      />
                    </label>
                    <label>
                      <span>Atual</span>
                      <input
                        type="number"
                        value={kr.currentValue}
                        onChange={(event) => {
                          const value = Number(event.target.value);
                          setDashboardConfig((prev) => {
                            const next = [...(prev.okrs ?? [])];
                            const nextKrs = [...next[okrIdx].keyResults];
                            nextKrs[krIdx] = {
                              ...nextKrs[krIdx],
                              currentValue: Number.isFinite(value) ? value : 0,
                            };
                            next[okrIdx] = { ...next[okrIdx], keyResults: nextKrs };
                            return { ...prev, okrs: next };
                          });
                        }}
                      />
                    </label>
                    <label>
                      <span>Meta</span>
                      <input
                        type="number"
                        value={kr.targetValue}
                        onChange={(event) => {
                          const value = Number(event.target.value);
                          setDashboardConfig((prev) => {
                            const next = [...(prev.okrs ?? [])];
                            const nextKrs = [...next[okrIdx].keyResults];
                            nextKrs[krIdx] = {
                              ...nextKrs[krIdx],
                              targetValue: Number.isFinite(value) ? value : 1,
                            };
                            next[okrIdx] = { ...next[okrIdx], keyResults: nextKrs };
                            return { ...prev, okrs: next };
                          });
                        }}
                      />
                    </label>
                    <button
                      type="button"
                      className="btn secondary"
                      onClick={() =>
                        setDashboardConfig((prev) => {
                          const next = [...(prev.okrs ?? [])];
                          const nextKrs = [...next[okrIdx].keyResults];
                          nextKrs.splice(krIdx, 1);
                          next[okrIdx] = { ...next[okrIdx], keyResults: nextKrs };
                          return { ...prev, okrs: next };
                        })
                      }
                    >
                      Remover KR
                    </button>
                  </div>
                ))}
                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    type="button"
                    className="btn secondary"
                    onClick={() =>
                      setDashboardConfig((prev) => {
                        const next = [...(prev.okrs ?? [])];
                        const okrItem: OkrInput = next[okrIdx] ?? { objectiveTitle: "", keyResults: [] };
                        next[okrIdx] = {
                          ...okrItem,
                          keyResults: [
                            ...(okrItem.keyResults ?? []),
                            { title: "Novo KR", currentValue: 0, targetValue: 1 },
                          ],
                        };
                        return { ...prev, okrs: next };
                      })
                    }
                  >
                    Adicionar KR
                  </button>
                  <button
                    type="button"
                    className="btn secondary"
                    onClick={() =>
                      setDashboardConfig((prev) => {
                        const next = [...(prev.okrs ?? [])];
                        next.splice(okrIdx, 1);
                        return { ...prev, okrs: next };
                      })
                    }
                  >
                    Remover objetivo
                  </button>
                </div>
              </div>
            ))}
            <button
              type="button"
              className="btn secondary"
              onClick={() =>
                setDashboardConfig((prev) => ({
                  ...prev,
                  okrs: [
                    ...(prev.okrs ?? []),
                    {
                      objectiveTitle: "Novo objetivo",
                      keyResults: [{ title: "Novo KR", currentValue: 0, targetValue: 1 }],
                    },
                  ],
                }))
              }
            >
              Adicionar objetivo OKR
            </button>
          </div>
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button
            type="button"
            className="btn"
            onClick={() => {
              const mode = quickMode ? "quick" : "reviewed";
              const derivedDisabled = !isValidTabularFile(selectedFile) || loading;
              // #region agent log
              appendClientDebugLog({
                hypothesisId: "D",
                location: "app/page.tsx:process-button-onClick",
                message: "Process button click received",
                data: {
                  mode,
                  hasSelectedFile: Boolean(selectedFile),
                  loading,
                  derivedDisabled,
                },
                timestamp: Date.now(),
              });
              // #endregion
              if (derivedDisabled) {
                return;
              }
              void runAnalysis(mode, quickMode ? undefined : rules ?? undefined);
            }}
            disabled={!isValidTabularFile(selectedFile) || loading}
          >
            {loading ? "Processando..." : "Processar arquivo"}
          </button>
        </div>
        {loading && <div className="pill">Processando arquivo e aguardando resposta da API...</div>}
        {error && (
          <div className="pill danger" style={{ width: "fit-content" }}>
            {error}
          </div>
        )}
      </section>

      {debugJson && (
        <section className="card">
          <h3 style={{ marginTop: 0 }}>Debug temporario: JSON bruto retornado</h3>
          <pre
            style={{
              margin: 0,
              whiteSpace: "pre-wrap",
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
              fontSize: 12,
              lineHeight: 1.45,
              color: "var(--muted)",
              maxHeight: 320,
              overflow: "auto",
            }}
          >
            {debugJson}
          </pre>
        </section>
      )}
      {result && !quickMode && rules && (
        <RuleReviewPanel
          qaAnalysis={result.qaAnalysis}
          initialRules={rules}
          onApply={async (nextRules) => {
            setRules(nextRules);
            await runAnalysis("reviewed", nextRules);
          }}
          onSkip={() => {
            setQuickMode(true);
            runAnalysis("quick");
          }}
          loading={loading}
        />
      )}

      {result && (
        <>
          <section className="card" style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
            <div>
              <h3 style={{ margin: 0 }}>Exportacao de resumo</h3>
              <p style={{ marginBottom: 0, color: "var(--muted)" }}>
                Gere um texto executivo em linguagem simples com principais resultados.
              </p>
            </div>
            <button className="btn secondary" onClick={exportSummary} disabled={summaryLoading}>
              {summaryLoading ? "Gerando..." : "Gerar resumo textual"}
            </button>
          </section>
          {summaryText && (
            <section className="card">
              <h4 style={{ marginTop: 0 }}>Resumo exportavel</h4>
              <pre
                style={{
                  whiteSpace: "pre-wrap",
                  margin: 0,
                  fontFamily: "inherit",
                  color: "var(--muted)",
                  lineHeight: 1.5,
                }}
              >
                {summaryText}
              </pre>
            </section>
          )}
          <ResultsView result={result} />
        </>
      )}
    </main>
  );
}
