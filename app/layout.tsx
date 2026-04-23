import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AutoTab Insight",
  description:
    "Analise automatica de arquivos CSV/Excel com dashboards, insights e alertas.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
