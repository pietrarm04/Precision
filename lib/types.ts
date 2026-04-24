export type DatasetType =
  | "sales"
  | "finance"
  | "inventory"
  | "survey_satisfaction"
  | "productivity"
  | "inspection_checklist"
  | "operations_maintenance"
  | "generic";

export type ColumnType = "number" | "date" | "string" | "boolean" | "mixed" | "empty";

export type RowMap = Record<string, unknown>;

export interface ParsedTabularFile {
  fileName: string;
  extension: "csv" | "xlsx" | "xls";
  headers: string[];
  rows: RowMap[];
  warnings: string[];
  errors: string[];
}

export interface NormalizedDataset {
  headers: string[];
  rows: RowMap[];
  duplicateHeaders: string[];
  removedColumns: string[];
  normalizationNotes: string[];
  rawWarnings: string[];
}

export interface DatasetTypeInference {
  datasetType: DatasetType;
  confidence: number;
  reasons: string[];
  scores: Record<DatasetType, number>;
}

export type QAOutcome = "yes" | "no" | "pass" | "fail" | "na" | "unknown";
export type SemanticQuestionPolarity = "positive" | "negative" | "neutral";
export type SemanticResult = "real_failure" | "non_failure" | "na" | "undetermined";
export type WeightSource = "usuario_pergunta" | "usuario_secao" | "usuario_tema" | "inferido" | "default";
export type WeightedRiskLevel = "regular" | "atencao" | "risco_multa" | "risco_interdicao";
export type FailureSeverityLabel = "leve" | "grave" | "gravissimo";

export interface QAItem {
  question: string;
  responseRaw: string;
  normalizedOutcome: QAOutcome;
  section?: string;
  theme?: string;
  date?: string;
  semanticPolarity: SemanticQuestionPolarity;
  semanticResult: SemanticResult;
  critical: boolean;
  weight: number;
  weightSource?: WeightSource;
  sourceRow: RowMap;
}

export interface WeightedIssue {
  question: string;
  section?: string;
  failures: number;
  total: number;
  failureRate: number;
  weight: number;
  critical: boolean;
  weightedScore: number;
}

export interface DashboardWidget {
  id: string;
  title: string;
  description: string;
  widgetType: "bar" | "line" | "pie" | "table";
  data: Array<Record<string, string | number>>;
  config: Record<string, unknown>;
}

export type KpiKey =
  | "ics_medio"
  | "ics_minimo"
  | "ics_maximo"
  | "desvio_padrao_ics"
  | "total_nao_conformidades"
  | "nao_conformidades_criticas"
  | "percentual_nao_conformidade"
  | "percentual_nao_aplicavel"
  | "score_medio"
  | "quantidade_inspecoes";

export type DashboardGrouping = "loja" | "setor" | "template" | "periodo";

export interface OkrInput {
  objectiveTitle: string;
  keyResults: Array<{
    title: string;
    currentValue: number;
    targetValue: number;
  }>;
}

export interface DashboardCustomizationConfig {
  selectedKpis: KpiKey[];
  grouping: DashboardGrouping;
  debugMode?: boolean;
  primaryIcsMetric?: "simples" | "ponderado";
  kpiTargets?: Partial<Record<KpiKey, number>>;
  questionWeights?: Array<{
    questionText: string;
    weight: number;
  }>;
  sectionWeights?: Array<{
    section: string;
    weight: number;
  }>;
  themeWeights?: Array<{
    theme: string;
    weight: number;
  }>;
  visibleSections?: {
    kpiOverview: boolean;
    sanitaryPerformance: boolean;
    okr: boolean;
    risk: boolean;
    pareto: boolean;
  };
  okrs?: OkrInput[];
}

export interface ManualQuestionOverride {
  questionText: string;
  behavior: "positive" | "negative" | "neutral" | "ignore";
  includeInAnalysis: boolean;
  weight: number;
  critical: boolean;
  reason?: string;
}

export interface ManualSectionWeight {
  section: string;
  weight: number;
}

export interface ManualReviewConfig {
  mode: "quick" | "reviewed";
  binaryInterpretationMode:
    | "auto"
    | "treat_yes_as_positive"
    | "treat_no_as_failure"
    | "treat_yes_as_failure_for_negative_questions";
  questionOverrides: ManualQuestionOverride[];
  sectionWeights: ManualSectionWeight[];
  notes?: string;
}

export interface SourceScoreSummary {
  score: number;
  totalScore: number;
  compliancePercentage: number;
  scoreColumn: string;
  totalScoreColumn: string;
  isMaxScore: boolean;
  explanation: string;
}

export interface WeightedMetricsSummary {
  icsSimple: number;
  icsWeighted: number;
  totalSimpleFailures: number;
  totalWeightedFailures: number;
  weightedFailureScore: number;
  weightedRiskScore: number;
  averageFailureSeverity: number;
  averageQuestionWeight: number;
  averageFailureWeight: number;
  criticalFailures: number;
  recurrenceFailures: number;
  affectedSections: number;
  weightedRiskClassification: WeightedRiskLevel;
  weightSourceBreakdown: Record<WeightSource, number>;
}

export interface MultiUnitComparisonRow {
  unitId: string;
  fileName: string;
  unitName: string;
  userLabel?: string;
  icsSimple: number;
  icsWeighted: number;
  totalFailures: number;
  weightedFailures: number;
  criticalFailures: number;
  weightedRiskScore: number;
  riskLevel: WeightedRiskLevel;
  failureRatePercentage: number;
}

export interface MultiUnitParetoRow {
  causa: string;
  frequenciaFalhas: number;
  impactoPonderado: number;
  impactoPercentual: number;
  impactoAcumulado: number;
}

export interface MultiUnitAnalysisResult {
  grouping: "loja" | "setor";
  totalFiles: number;
  comparedFiles: number;
  comparisonTable: MultiUnitComparisonRow[];
  ranking: MultiUnitComparisonRow[];
  bestWorst: {
    bestUnit?: string;
    worstUnit?: string;
    highestRiskUnit?: string;
    highestVariationUnit?: string;
    icsWeightedStdDev: number;
  };
  riskDistribution: Array<{
    level: WeightedRiskLevel;
    label: string;
    count: number;
  }>;
  widgets: DashboardWidget[];
  globalPareto: {
    ranking: MultiUnitParetoRow[];
    widgets: DashboardWidget[];
  };
  perUnitPareto?: Array<{
    unitName: string;
    ranking: MultiUnitParetoRow[];
  }>;
  insights: string[];
  errors: Array<{
    fileName: string;
    unitLabel?: string;
    message: string;
  }>;
}

export interface MultiAnalyzeFileInput {
  id?: string;
  fileName: string;
  fileBase64: string;
  unitLabel?: string;
  includeInComparison?: boolean;
}

export interface AnalysisResult {
  debugMode?: boolean;
  analysisDebug?: {
    debugMode: boolean;
  };
  datasetType: DatasetType;
  datasetTypeConfidence: number;
  rowCount: number;
  columnCount: number;
  detectedColumns: string[];
  parsingDiagnostics: {
    partial: boolean;
    warnings: string[];
    errors: string[];
  };
  structuralQuality: {
    score: number;
    label: "limpo" | "intermediario" | "baguncado";
    notes: string[];
  };
  columnProfiles: Array<{
    name: string;
    type: ColumnType;
    missingCount: number;
    sampleValues: string[];
  }>;
  summaryCards: Array<{
    label: string;
    value: string;
    emphasis?: "default" | "success" | "warning" | "danger";
  }>;
  dashboardWidgets: DashboardWidget[];
  insights: string[];
  alerts: string[];
  summaryText: string;
  interpretedPreview: RowMap[];
  sourceScore?: SourceScoreSummary;
  qaAnalysis?: {
    totalItems: number;
    realFailures: number;
    nonFailures: number;
    notApplicable: number;
    undetermined: number;
    icsSimple?: number;
    icsWeighted?: number;
    totalWeightedFailures?: number;
    weightedRiskScore?: number;
    averageFailureSeverity?: number;
    averageQuestionWeight?: number;
    averageFailureWeight?: number;
    weightedRiskClassification?: WeightedRiskLevel;
    weightSourceSummary?: {
      usuarioPergunta: number;
      usuarioSecao: number;
      usuarioTema: number;
      inferido: number;
      default: number;
    };
    sourceScore?: SourceScoreSummary;
    bySection: Array<{ section: string; total: number }>;
    topFailedQuestions: Array<{ question: string; total: number }>;
    weightedIssues: WeightedIssue[];
    ambiguousQuestions: ManualQuestionOverride[];
  };
  multiUnit?: MultiUnitAnalysisResult;
  customDashboards?: {
    configApplied: DashboardCustomizationConfig;
    kpiOverview?: {
      cards: Array<{
        key: KpiKey;
        label: string;
        currentValue: number;
        currentValueLabel: string;
        targetValue?: number;
        targetValueLabel?: string;
        status: "atingido" | "atencao" | "critico";
      }>;
      missingMessage?: string;
    };
    sanitaryPerformance?: {
      widgets: DashboardWidget[];
      missingMessage?: string;
    };
    okr?: {
      objectives: Array<{
        objectiveTitle: string;
        progressPercentage: number;
        status: "atingido" | "atencao" | "critico";
        keyResults: Array<{
          title: string;
          currentValue: number;
          targetValue: number;
          progressPercentage: number;
          status: "atingido" | "atencao" | "critico";
        }>;
      }>;
      missingMessage?: string;
    };
    risk?: {
      counts: Array<{
        level: WeightedRiskLevel;
        label: string;
        count: number;
      }>;
      ranking: Array<{
        group: string;
        icsSimple: number;
        icsWeighted: number;
        simpleFailures: number;
        weightedFailures: number;
        averageWeight: number;
        criticalCount: number;
        weightedRiskScore: number;
        level: WeightedRiskLevel;
      }>;
      missingMessage?: string;
    };
    pareto?: {
      widgets: DashboardWidget[];
      ranking: Array<{
        dimensao: "pergunta" | "secao" | "categoria";
        causa: string;
        frequenciaFalhas: number;
        impactoPonderado: number;
        impactoPercentual: number;
        impactoAcumulado: number;
        pesoMedio: number;
        criticidade: FailureSeverityLabel;
      }>;
      highlights: Array<{
        dimensao: "pergunta" | "secao" | "categoria";
        resumo: string;
      }>;
      missingMessage?: string;
    };
    weightedComparison?: {
      icsSimple: number;
      icsWeighted: number;
      weightedRiskScore: number;
      averageFailureWeight: number;
      weightedRiskClassification: WeightedRiskLevel;
    };
    weightTransparency?: {
      bySource: {
        usuarioPergunta: number;
        usuarioSecao: number;
        usuarioTema: number;
        inferido: number;
        default: number;
      };
      message: string;
    };
  };
  transparency: {
    normalizationActions: string[];
    parsingWarnings: string[];
    appliedRules: {
      mode: "quick" | "reviewed";
      binaryInterpretationMode: ManualReviewConfig["binaryInterpretationMode"];
      questionOverrides: number;
      sectionWeights: number;
      notes: string;
    };
  };
  normalizedRowsForExport: RowMap[];
}

export interface AnalyzeRequestPayload {
  fileName: string;
  fileBase64: string;
  files?: MultiAnalyzeFileInput[];
  mode: "quick" | "reviewed";
  rules?: ManualReviewConfig;
  dashboardConfig?: DashboardCustomizationConfig;
  grouping?: "loja" | "setor";
  includeUnitPareto?: boolean;
  debugMode?: boolean;
}
