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
  weight: z.number().min(1).max(5).default(1),
  critical: z.boolean().default(false),
  reason: z.string().optional(),
});

const sectionWeightSchema = z.object({
  section: z.string(),
  weight: z.number().min(1).max(5),
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
  kpiTargets: z.record(kpiKeySchema, z.number()).optional(),
  visibleSections: z
    .object({
      kpiOverview: z.boolean().default(true),
      sanitaryPerformance: z.boolean().default(true),
      okr: z.boolean().default(true),
      risk: z.boolean().default(true),
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
});

function toArrayBuffer(buffer: Buffer): ArrayBuffer {
  return buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength,
  ) as ArrayBuffer;
}

function isSupportedExtension(fileName: string): boolean {
  return /\.(csv|xlsx|xls)$/i.test(fileName);
}
export async function POST(request: Request) {
  try {
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
