"use client";

import { useEffect, useMemo, useState } from "react";
import { RuleReviewPanel } from "@/components/RuleReviewPanel";
import { ResultsView } from "@/components/ResultsView";
import { AnalysisResult, ManualQuestionOverride, ManualReviewConfig } from "@/lib/types";

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

function createDefaultRules(result: AnalysisResult): ManualReviewConfig {
  return {
    mode: "reviewed",
    binaryInterpretationMode: "auto",
    questionOverrides: (result.qaAnalysis?.ambiguousQuestions ?? []).map((item: ManualQuestionOverride) => item),
    sectionWeights: [],
    notes: "",
  };
}

export default function HomePage() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [quickMode, setQuickMode] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [rules, setRules] = useState<ManualReviewConfig | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryText, setSummaryText] = useState<string | null>(null);
  const [sampleFiles, setSampleFiles] = useState<string[]>([]);
  const [selectedSample, setSelectedSample] = useState<string>("");
  const [sampleLoading, setSampleLoading] = useState(false);

  const fileInfo = useMemo(() => {
    if (!selectedFile) {
      return null;
    }
    return `${selectedFile.name} · ${(selectedFile.size / 1024).toFixed(1)} KB`;
  }, [selectedFile]);

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

  async function runAnalysis(mode: "quick" | "reviewed", reviewRules?: ManualReviewConfig) {
    if (!selectedFile) {
      setError("Selecione um arquivo antes de iniciar a analise.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const fileBase64 = await fileToBase64(selectedFile);
      const payload = {
        fileName: selectedFile.name,
        fileBase64,
        mode,
        rules: reviewRules,
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
      if (mode === "reviewed") {
        setRules(reviewRules ?? createDefaultRules(data));
      }
    } catch (analysisError) {
      setError(
        analysisError instanceof Error
          ? analysisError.message
          : "Nao foi possivel concluir a analise.",
      );
    } finally {
      setLoading(false);
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
            if (!file) {
              setSelectedFile(null);
              setError(
                "Nenhum arquivo foi selecionado. Se estiver em ambiente remoto, escolha um arquivo local do computador ou use o carregamento de exemplo.",
              );
              return;
            }
            setSelectedFile(file);
            setResult(null);
            setRules(null);
            setSummaryText(null);
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
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button
            type="button"
            className="btn"
            onClick={() =>
              void runAnalysis(quickMode ? "quick" : "reviewed", quickMode ? undefined : rules ?? undefined)
            }
            disabled={!selectedFile || loading}
          >
            {loading ? "Processando..." : "Processar arquivo"}
          </button>
        </div>
        {error && (
          <div className="pill danger" style={{ width: "fit-content" }}>
            {error}
          </div>
        )}
      </section>

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
