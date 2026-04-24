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
  debugMode: z.boolean().optional(),
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

function boolFromUnknown(value: unknown): boolean | undefined {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") return true;
    if (normalized === "false") return false;
  }
  return undefined;
}

async function analyzeSingleFile(args: {
  fileName: string;
  fileBytes: ArrayBuffer;
  mode: "quick" | "reviewed";
  rules?: z.infer<typeof reviewSchema>;
  dashboardConfig?: DashboardCustomizationConfig;
  debugMode?: boolean;
}) {
  const result = runAnalysisPipeline(args.fileName, args.fileBytes, {
    mode: args.mode,
    rules: args.rules,
    dashboardConfig: args.dashboardConfig,
    debugMode: args.debugMode,
  });
  return result;
}

export async function POST(request: Request) {
  try {
    const contentType = request.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().includes("multipart/form-data")) {
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
        location: "app/api/analyze/route.ts:POST-entry-json",
        message: "Analyze API received JSON payload",
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
      const result = await analyzeSingleFile({
        fileName: payload.fileName,
        fileBytes: toArrayBuffer(fileBuffer),
        mode: payload.mode,
        rules: payload.rules,
        dashboardConfig,
        debugMode: payload.debugMode,
      });
      return NextResponse.json(result);
    }

    const formData = await request.formData();
    const mode = z.enum(["quick", "reviewed"]).parse(String(formData.get("mode") ?? "quick"));
    const rulesRaw = formData.get("rules");
    const dashboardConfigRaw = formData.get("dashboardConfig");
    const debugModeRaw = formData.get("debugMode");
    const rules =
      typeof rulesRaw === "string" && rulesRaw.trim().length > 0
        ? reviewSchema.parse(JSON.parse(rulesRaw))
        : undefined;
    const dashboardConfig =
      typeof dashboardConfigRaw === "string" && dashboardConfigRaw.trim().length > 0
        ? (dashboardConfigSchema.parse(JSON.parse(dashboardConfigRaw)) as DashboardCustomizationConfig)
        : undefined;
    const debugMode = boolFromUnknown(debugModeRaw);

    const allFiles = formData.getAll("files").filter((entry): entry is File => entry instanceof File);
    const maybeSingle = formData.get("file");
    if (allFiles.length === 0 && maybeSingle instanceof File) {
      allFiles.push(maybeSingle);
    }

    if (allFiles.length === 0) {
      return NextResponse.json(
        {
          message: "Nenhum arquivo enviado. Envie um ou mais arquivos via campo 'files'.",
          supportedFormats: ["csv", "xlsx", "xls"],
        },
        { status: 400 },
      );
    }

    // #region agent log
    appendDebugLog({
      hypothesisId: "E",
      location: "app/api/analyze/route.ts:POST-entry-multipart",
      message: "Analyze API received multipart payload",
      data: {
        mode,
        fileCount: allFiles.length,
        fileNames: allFiles.map((file) => file.name),
        hasRules: Boolean(rules),
        hasDashboardConfig: Boolean(dashboardConfig),
        okrCount: dashboardConfig?.okrs?.length ?? 0,
      },
      timestamp: Date.now(),
    });
    // #endregion

    const results: Array<{ fileName: string; result?: Awaited<ReturnType<typeof analyzeSingleFile>>; error?: string }> =
      [];
    for (const file of allFiles) {
      if (!isSupportedExtension(file.name)) {
        results.push({
          fileName: file.name,
          error: "Formato nao suportado. Envie CSV, XLSX ou XLS.",
        });
        continue;
      }
      const fileBytes = await file.arrayBuffer();
      if (fileBytes.byteLength === 0) {
        results.push({
          fileName: file.name,
          error: "Arquivo vazio apos upload.",
        });
        continue;
      }
      try {
        const analyzed = await analyzeSingleFile({
          fileName: file.name,
          fileBytes,
          mode,
          rules,
          dashboardConfig,
          debugMode,
        });
        results.push({
          fileName: file.name,
          result: analyzed,
        });
      } catch (fileError) {
        results.push({
          fileName: file.name,
          error:
            fileError instanceof Error
              ? fileError.message
              : "Nao foi possivel processar o arquivo. Verifique formato e tente novamente.",
        });
      }
    }

    if (allFiles.length === 1) {
      const single = results[0];
      if (single?.result) {
        return NextResponse.json(single.result);
      }
      return NextResponse.json(
        { message: single?.error ?? "Nao foi possivel processar o arquivo." },
        { status: 400 },
      );
    }

    const successCount = results.filter((entry) => entry.result).length;
    const failureCount = results.filter((entry) => entry.error).length;
    return NextResponse.json({
      mode,
      results,
      summary: {
        total: results.length,
        successCount,
        failureCount,
      },
    });
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
