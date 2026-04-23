import { NextResponse } from "next/server";
import { z } from "zod";
import { runAnalysisPipeline } from "@/lib/pipeline";

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

const requestSchema = z.object({
  fileName: z.string().min(3),
  fileBase64: z.string().min(8),
  mode: z.enum(["quick", "reviewed"]).default("quick"),
  rules: reviewSchema.optional(),
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

    const result = runAnalysisPipeline(
      payload.fileName,
      toArrayBuffer(fileBuffer),
      {
        mode: payload.mode,
        rules: payload.rules,
      },
    );
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
