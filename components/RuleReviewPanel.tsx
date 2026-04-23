"use client";

import { useMemo, useState } from "react";
import { AnalysisResult, ManualQuestionOverride, ManualReviewConfig } from "@/lib/types";

type RuleReviewPanelProps = {
  qaAnalysis: AnalysisResult["qaAnalysis"];
  initialRules: ManualReviewConfig;
  onApply: (config: ManualReviewConfig) => void;
  onSkip: () => void;
  loading: boolean;
};

function behaviorLabel(value: ManualQuestionOverride["behavior"]): string {
  switch (value) {
    case "positive":
      return "Pergunta positiva";
    case "negative":
      return "Pergunta negativa";
    case "neutral":
      return "Neutra";
    case "ignore":
      return "Ignorar";
    default:
      return value;
  }
}

export function RuleReviewPanel({
  qaAnalysis,
  initialRules,
  onApply,
  onSkip,
  loading,
}: RuleReviewPanelProps) {
  const bootstrapOverrides = useMemo(() => {
    if (initialRules.questionOverrides.length > 0) {
      return initialRules.questionOverrides;
    }
    return (qaAnalysis?.ambiguousQuestions ?? []).slice(0, 12).map((item) => ({
      ...item,
      includeInAnalysis: true,
      weight: item.weight || 1,
    }));
  }, [initialRules.questionOverrides, qaAnalysis?.ambiguousQuestions]);

  const [state, setState] = useState<ManualReviewConfig>({
    ...initialRules,
    mode: "reviewed",
    questionOverrides: bootstrapOverrides,
    sectionWeights:
      initialRules.sectionWeights.length > 0
        ? initialRules.sectionWeights
        : (qaAnalysis?.bySection ?? []).slice(0, 8).map((item) => ({
            section: item.section,
            weight: 1,
          })),
  });

  function updateOverride(index: number, patch: Partial<ManualQuestionOverride>) {
    const next = [...state.questionOverrides];
    next[index] = { ...next[index], ...patch };
    setState((prev) => ({ ...prev, questionOverrides: next }));
  }

  function updateBinaryMode(mode: ManualReviewConfig["binaryInterpretationMode"]) {
    setState((prev) => ({ ...prev, binaryInterpretationMode: mode }));
  }

  return (
    <section className="card">
      <h2 style={{ marginTop: 0 }}>Revisao opcional de regras</h2>
      <p style={{ color: "var(--muted)" }}>
        Esta etapa e recomendada para checklist/inspecao quando nem todo &quot;nao&quot; significa falha.
      </p>

      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))" }}>
        <label>
          <span>Modo binario</span>
          <select
            value={state.binaryInterpretationMode}
            onChange={(event) =>
              updateBinaryMode(event.target.value as ManualReviewConfig["binaryInterpretationMode"])
            }
          >
            <option value="auto">Manter interpretacao automatica sugerida</option>
            <option value="treat_yes_as_positive">Tratar &quot;sim&quot; como positivo por padrao</option>
            <option value="treat_no_as_failure">Tratar &quot;nao&quot; como falha por padrao</option>
            <option value="treat_yes_as_failure_for_negative_questions">
              Tratar &quot;sim&quot; como falha quando pergunta descreve problema
            </option>
          </select>
        </label>
      </div>

      {state.sectionWeights.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <h3 style={{ marginBottom: 8 }}>Peso por secao</h3>
          <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
            {state.sectionWeights.map((item, index) => (
              <label key={`${item.section}-${index}`}>
                <span>{item.section}</span>
                <input
                  type="number"
                  min={1}
                  max={5}
                  value={item.weight}
                  onChange={(event) => {
                    const weight = Math.max(1, Math.min(5, Number(event.target.value) || 1));
                    setState((prev) => {
                      const next = [...prev.sectionWeights];
                      next[index] = { ...next[index], weight };
                      return { ...prev, sectionWeights: next };
                    });
                  }}
                />
              </label>
            ))}
          </div>
        </div>
      )}

      <div style={{ marginTop: 16 }}>
        <h3 style={{ marginBottom: 8 }}>Perguntas com ambiguidade para revisar</h3>
        <div style={{ maxHeight: 340, overflow: "auto", border: "1px solid var(--border)", borderRadius: 10 }}>
          <table>
            <thead>
              <tr>
                <th>Pergunta</th>
                <th>Comportamento</th>
                <th>Peso</th>
                <th>Critica</th>
                <th>Ignorar</th>
              </tr>
            </thead>
            <tbody>
              {state.questionOverrides.length === 0 && (
                <tr>
                  <td colSpan={5}>Nenhuma pergunta ambigua detectada.</td>
                </tr>
              )}
              {state.questionOverrides.map((item, index) => (
                <tr key={`${item.questionText}-${index}`}>
                  <td style={{ maxWidth: 360 }}>{item.questionText}</td>
                  <td>
                    <select
                      value={item.behavior}
                      onChange={(event) =>
                        updateOverride(index, {
                          behavior: event.target.value as ManualQuestionOverride["behavior"],
                        })
                      }
                    >
                      <option value="positive">{behaviorLabel("positive")}</option>
                      <option value="negative">{behaviorLabel("negative")}</option>
                      <option value="neutral">{behaviorLabel("neutral")}</option>
                      <option value="ignore">{behaviorLabel("ignore")}</option>
                    </select>
                  </td>
                  <td style={{ width: 110 }}>
                    <input
                      type="number"
                      min={1}
                      max={5}
                      value={item.weight}
                      onChange={(event) => {
                        const weight = Number(event.target.value);
                        updateOverride(index, { weight: Number.isFinite(weight) ? Math.max(1, Math.min(5, weight)) : 1 });
                      }}
                    />
                  </td>
                  <td>
                    <input
                      type="checkbox"
                      checked={item.critical}
                      onChange={(event) => updateOverride(index, { critical: event.target.checked })}
                    />
                  </td>
                  <td>
                    <input
                      type="checkbox"
                      checked={!item.includeInAnalysis || item.behavior === "ignore"}
                      onChange={(event) =>
                        updateOverride(index, {
                          includeInAnalysis: !event.target.checked,
                          behavior: event.target.checked ? "ignore" : "neutral",
                        })
                      }
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
        <button className="btn" onClick={() => onApply(state)} disabled={loading}>
          {loading ? "Reanalisando..." : "Aplicar revisao e analisar"}
        </button>
        <button className="btn secondary" onClick={onSkip} disabled={loading}>
          Seguir com analise rapida
        </button>
      </div>
    </section>
  );
}
