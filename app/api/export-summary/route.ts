import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { AnalysisResult } from "@/lib/types";

const schema = z.object({
  summaryText: z.string().min(1),
  datasetType: z.string(),
  rowCount: z.number(),
  columnCount: z.number(),
});

export async function POST(request: NextRequest) {
  try {
    const payload = (await request.json()) as AnalysisResult;
    const parsed = schema.parse(payload);
    return NextResponse.json({
      text: [
        "Resumo executivo da analise",
        `Dataset: ${parsed.datasetType}`,
        `Volume: ${parsed.rowCount} linhas e ${parsed.columnCount} colunas`,
        "",
        parsed.summaryText,
      ].join("\n"),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha ao exportar resumo.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
