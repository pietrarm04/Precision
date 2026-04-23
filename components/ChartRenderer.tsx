"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { DashboardWidget } from "@/lib/types";

const COLORS = ["#66b2ff", "#50d890", "#ffc857", "#ff6b7a", "#b38bff", "#65e2ff"];

function DataTable({ rows }: { rows: Array<Record<string, string | number>> }) {
  if (rows.length === 0) return <p style={{ color: "var(--muted)" }}>Sem dados para tabela.</p>;
  const columns = Object.keys(rows[0]);
  return (
    <div style={{ overflowX: "auto" }}>
      <table>
        <thead>
          <tr>
            {columns.map((col) => (
              <th key={col}>{col}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={`${index}-${row[columns[0]]}`}>
              {columns.map((col) => (
                <td key={col}>{String(row[col] ?? "")}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ChartRenderer({ widget }: { widget: DashboardWidget }) {
  const height = 280;
  const xKey = String(widget.config.xKey ?? "label");
  const yKey = String(widget.config.yKey ?? "value");
  const nameKey = String(widget.config.nameKey ?? "label");
  const valueKey = String(widget.config.valueKey ?? "value");

  return (
    <section className="card">
      <h4 style={{ marginTop: 0 }}>{widget.title}</h4>
      <p style={{ marginTop: 4, color: "var(--muted)" }}>{widget.description}</p>

      {widget.widgetType === "table" ? (
        <DataTable rows={widget.data} />
      ) : (
        <div style={{ width: "100%", height }}>
          <ResponsiveContainer>
            {widget.widgetType === "bar" ? (
              <BarChart data={widget.data}>
                <CartesianGrid strokeDasharray="3 3" stroke="#2b3765" />
                <XAxis dataKey={xKey} stroke="#a4b2d8" />
                <YAxis stroke="#a4b2d8" />
                <Tooltip />
                <Legend />
                <Bar dataKey={yKey} fill="#66b2ff" radius={[6, 6, 0, 0]} />
              </BarChart>
            ) : widget.widgetType === "line" ? (
              <LineChart data={widget.data}>
                <CartesianGrid strokeDasharray="3 3" stroke="#2b3765" />
                <XAxis dataKey={xKey} stroke="#a4b2d8" />
                <YAxis stroke="#a4b2d8" />
                <Tooltip />
                <Legend />
                <Line type="monotone" dataKey={yKey} stroke="#50d890" strokeWidth={3} dot={false} />
              </LineChart>
            ) : (
              <PieChart>
                <Pie data={widget.data} dataKey={valueKey} nameKey={nameKey} outerRadius={95} label>
                  {widget.data.map((entry, index) => (
                    <Cell key={`cell-${index}-${entry[nameKey]}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
                <Legend />
              </PieChart>
            )}
          </ResponsiveContainer>
        </div>
      )}
    </section>
  );
}
