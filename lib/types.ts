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

export interface QAItem {
  question: string;
  responseRaw: string;
  normalizedOutcome: QAOutcome;
  section?: string;
  date?: string;
  semanticPolarity: SemanticQuestionPolarity;
  semanticResult: SemanticResult;
  critical: boolean;
  weight: number;
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
  kpiTargets?: Partial<Record<KpiKey, number>>;
  visibleSections?: {
    kpiOverview: boolean;
    sanitaryPerformance: boolean;
    okr: boolean;
    risk: boolean;
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
    sourceScore?: SourceScoreSummary;
    bySection: Array<{ section: string; total: number }>;
    topFailedQuestions: Array<{ question: string; total: number }>;
    weightedIssues: WeightedIssue[];
    ambiguousQuestions: ManualQuestionOverride[];
  };
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
        level: "baixo_risco" | "atencao" | "possivel_multa" | "possivel_interdicao";
        label: string;
        count: number;
      }>;
      ranking: Array<{
        group: string;
        ics: number;
        failureRate: number;
        criticalCount: number;
        level: "baixo_risco" | "atencao" | "possivel_multa" | "possivel_interdicao";
      }>;
      missingMessage?: string;
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
  mode: "quick" | "reviewed";
  rules?: ManualReviewConfig;
  dashboardConfig?: DashboardCustomizationConfig;
  debugMode?: boolean;
}
