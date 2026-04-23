"use client";

import { AnalysisResult } from "@/lib/types";

type Props = {
  cards: AnalysisResult["summaryCards"];
};

export function StatCards({ cards }: Props) {
  return (
    <div className="grid cards-grid">
      {cards.map((card) => (
        <div className="card" key={card.label}>
          <div className={`pill ${card.emphasis === "danger" ? "danger" : card.emphasis === "warning" ? "warn" : card.emphasis === "success" ? "success" : ""}`}>
            {card.label}
          </div>
          <p className="big-value">{card.value}</p>
        </div>
      ))}
    </div>
  );
}
