"use client";

import { useMemo, useState } from "react";
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

  const fileInfo = useMemo(() => {
    if (!selectedFile) {
      return null;
    }
    return `${selectedFile.name} · ${(selectedFile.size / 1024).toFixed(1)} KB`;
  }, [selectedFile]);

  async function runAnalysis(mode: "quick" | "reviewed", reviewRules?: ManualReviewConfig) {
    if (!assertValidFile(selectedFile)) {
      setError("Selecione um arquivo CSV, XLSX ou XLS antes de iniciar a analise.");
      return;
    }
    setLoading(true);
    setError(null);
    setDebugJson(null);
    try {
      const payload = {
        fileName: selectedFile.name,
        fileBase64: await fileToBase64(selectedFile),
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
            const file = event.target.files?.[0] ?? null;
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
            setError(null);
          }}
        />
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
            onClick={() => runAnalysis(quickMode ? "quick" : "reviewed", quickMode ? undefined : rules ?? undefined)}
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
