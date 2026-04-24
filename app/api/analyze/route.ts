import { NextResponse } from "next/server";
import { z } from "zod";
import { runAnalysisPipeline } from "@/lib/pipeline";
import { appendDebugLog } from "@/lib/debugLog";
import { DashboardCustomizationConfig, KpiKey } from "@/lib/types";

export const runtime = "nodejs";

const questionOverrideSchema = z.object({
  questionText: z.string(),
  behavior: z.enum(["positive", "negative", "neutral", "ignore"]),
  includeInAnalysis: z.boolean().default(true),
  weight: z.number().min(1).max(3).default(1),
  critical: z.boolean().default(false),
  reason: z.string().optional(),
});

const sectionWeightSchema = z.object({
  section: z.string(),
  weight: z.number().min(1).max(3),
});

const reviewSchema = z.object({
  mode: z.enum(["quick", "reviewed"]).default("quick"),
  binaryInterpretationMode: z
    .enum([
      "auto",
      "treat_yes_as_positive",
      "treat_no_as_failure",
      "treat_yes_as_failure_for_negative_questions",
    ])
    .default("auto"),
  questionOverrides: z.array(questionOverrideSchema).default([]),
  sectionWeights: z.array(sectionWeightSchema).default([]),
  notes: z.string().optional(),
});

const kpiKeySchema = z.enum([
  "ics_medio",
  "ics_minimo",
  "ics_maximo",
  "desvio_padrao_ics",
  "total_nao_conformidades",
  "nao_conformidades_criticas",
  "percentual_nao_conformidade",
  "percentual_nao_aplicavel",
  "score_medio",
  "quantidade_inspecoes",
] as [KpiKey, ...KpiKey[]]);

const dashboardConfigSchema = z.object({
  selectedKpis: z.array(kpiKeySchema).default([]),
  grouping: z.enum(["loja", "setor", "template", "periodo"]).default("loja"),
  primaryIcsMetric: z.enum(["simples", "ponderado"]).optional(),
  kpiTargets: z
    .object({
      ics_medio: z.number().optional(),
      ics_minimo: z.number().optional(),
      ics_maximo: z.number().optional(),
      desvio_padrao_ics: z.number().optional(),
      total_nao_conformidades: z.number().optional(),
      nao_conformidades_criticas: z.number().optional(),
      percentual_nao_conformidade: z.number().optional(),
      percentual_nao_aplicavel: z.number().optional(),
      score_medio: z.number().optional(),
      quantidade_inspecoes: z.number().optional(),
    })
    .optional(),
  questionWeights: z
    .array(
      z.object({
        questionText: z.string().min(1),
        weight: z.number().min(1).max(3),
      }),
    )
    .optional(),
  sectionWeights: z
    .array(
      z.object({
        section: z.string().min(1),
        weight: z.number().min(1).max(3),
      }),
    )
    .optional(),
  themeWeights: z
    .array(
      z.object({
        theme: z.string().min(1),
        weight: z.number().min(1).max(3),
      }),
    )
    .optional(),
  visibleSections: z
    .object({
      kpiOverview: z.boolean().default(true),
      sanitaryPerformance: z.boolean().default(true),
      okr: z.boolean().default(true),
      risk: z.boolean().default(true),
      pareto: z.boolean().default(true),
    })
    .optional(),
  okrs: z
    .array(
      z.object({
        objectiveTitle: z.string().min(1),
        keyResults: z
          .array(
            z.object({
              title: z.string().min(1),
              currentValue: z.number(),
              targetValue: z.number(),
            }),
          )
          .default([]),
      }),
    )
    .default([]),
});

const requestSchema = z.object({
  fileName: z.string().min(3),
  fileBase64: z.string().min(8),
  mode: z.enum(["quick", "reviewed"]).default("quick"),
  rules: reviewSchema.optional(),
  dashboardConfig: dashboardConfigSchema.optional(),
  debugMode: z.boolean().optional(),
});

const modeSchema = z.enum(["quick", "reviewed"]).default("quick");

function toArrayBuffer(buffer: Buffer): ArrayBuffer {
  return buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength,
  ) as ArrayBuffer;
}

function isSupportedExtension(fileName: string): boolean {
  return /\.(csv|xlsx|xls)$/i.test(fileName);
}

function fileNameToUnit(fileName: string): string {
  return fileName
    .replace(/\.[^/.]+$/g, "")
    .replace(/[_\-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseOptionalJsonField<T>(
  formData: FormData,
  key: string,
  schema: z.ZodType<T>,
): T | undefined {
  const raw = formData.get(key);
  if (typeof raw !== "string" || raw.trim().length === 0) {
    return undefined;
  }
  return schema.parse(JSON.parse(raw));
}

async function handleMultipartAnalyze(request: Request) {
  const formData = await request.formData();
  const files = formData.getAll("files").filter((entry): entry is File => entry instanceof File);
  if (files.length === 0) {
    return NextResponse.json(
      {
        message: "Nenhum arquivo foi enviado. Use o campo 'files' no FormData.",
        supportedFormats: ["csv", "xlsx", "xls"],
      },
      { status: 400 },
    );
  }

  const mode = modeSchema.parse(formData.get("mode"));
  const debugModeRaw = formData.get("debugMode");
  const debugMode = typeof debugModeRaw === "string" ? debugModeRaw === "true" : undefined;
  const rules = parseOptionalJsonField(formData, "rules", reviewSchema);
  const dashboardConfig = parseOptionalJsonField(formData, "dashboardConfig", dashboardConfigSchema) as
    | DashboardCustomizationConfig
    | undefined;
  const unitLabels = formData
    .getAll("unitLabels")
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""));
  const unitIds = formData
    .getAll("unitIds")
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""));

  const results: Array<{
    unit: string;
    unitLabel?: string;
    unitId?: string;
    fileName: string;
    analysis: ReturnType<typeof runAnalysisPipeline>;
  }> = [];
  const errors: Array<{ fileName: string; unitLabel?: string; message: string }> = [];

  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    const unitLabel = unitLabels[index] || undefined;
    const unitId = unitIds[index] || undefined;
    if (!isSupportedExtension(file.name)) {
      errors.push({
        fileName: file.name,
        unitLabel,
        message: "Formato nao suportado. Envie CSV, XLSX ou XLS.",
      });
      continue;
    }
    try {
      const bytes = await file.arrayBuffer();
      if (bytes.byteLength === 0) {
        errors.push({
          fileName: file.name,
          unitLabel,
          message: "Arquivo recebido vazio.",
        });
        continue;
      }
      const analysis = runAnalysisPipeline(file.name, bytes, {
        mode,
        rules,
        dashboardConfig,
        debugMode,
      });
      results.push({
        unit: unitLabel || fileNameToUnit(file.name),
        unitLabel,
        unitId,
        fileName: file.name,
        analysis,
      });
    } catch (error) {
      errors.push({
        fileName: file.name,
        unitLabel,
        message:
          error instanceof Error
            ? error.message
            : "Nao foi possivel processar o arquivo. Verifique formato e tente novamente.",
      });
    }
  }

  if (results.length === 0) {
    return NextResponse.json(
      {
        message: "Nao foi possivel processar nenhum arquivo enviado.",
        errors,
      },
      { status: 400 },
    );
  }

  return NextResponse.json({
    results,
    errors,
  });
}

export async function POST(request: Request) {
  try {
    const contentType = request.headers.get("content-type") ?? "";
    if (contentType.includes("multipart/form-data")) {
      return await handleMultipartAnalyze(request);
    }

    const raw = await request.json();
    const payload = requestSchema.parse(raw);
    if (!isSupportedExtension(payload.fileName)) {
      return NextResponse.json(
        {
          message: "Formato nao suportado. Envie CSV, XLSX ou XLS.",
          supportedFormats: ["csv", "xlsx", "xls"],
        },
        { status: 400 },
      );
    }

    const fileBuffer = Buffer.from(payload.fileBase64, "base64");
    if (fileBuffer.byteLength === 0) {
      return NextResponse.json(
        {
          message: "Arquivo recebido vazio apos decodificacao base64.",
          supportedFormats: ["csv", "xlsx", "xls"],
        },
        { status: 400 },
      );
    }

    // #region agent log
    appendDebugLog({
      hypothesisId: "E",
      location: "app/api/analyze/route.ts:POST-entry",
      message: "Analyze API received payload",
      data: {
        mode: payload.mode,
        fileName: payload.fileName,
        hasRules: Boolean(payload.rules),
        hasDashboardConfig: Boolean(payload.dashboardConfig),
        okrCount: payload.dashboardConfig?.okrs.length ?? 0,
        base64Length: payload.fileBase64.length,
      },
      timestamp: Date.now(),
    });
    // #endregion
    const dashboardConfig = payload.dashboardConfig as DashboardCustomizationConfig | undefined;
    const result = runAnalysisPipeline(payload.fileName, toArrayBuffer(fileBuffer), {
      mode: payload.mode,
      rules: payload.rules,
      dashboardConfig,
      debugMode: payload.debugMode,
    });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          message: "Payload invalido para analise.",
          details: error.issues,
        },
        { status: 400 },
      );
    }
    const message =
      error instanceof Error
        ? error.message
        : "Nao foi possivel processar o arquivo. Verifique formato e tente novamente.";
    return NextResponse.json({ message }, { status: 500 });
  }
}
