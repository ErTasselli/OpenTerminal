"use client";

import { useQuery } from "@tanstack/react-query";
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip } from "recharts";
import { useT } from "../../lib/i18n";
import { apiGet, fmt } from "../../lib/api";

type FearGreed = {
  score: number;
  rating: string;
  timestamp: string;
  previousClose: number | null;
  previousWeek: number | null;
  previousMonth: number | null;
  previousYear: number | null;
  history: Array<{ t: number; v: number }>;
};

const ZONES = [
  { max: 25, label: "Extreme Fear", color: "#ff3b3b" },
  { max: 45, label: "Fear", color: "#ff8a3b" },
  { max: 55, label: "Neutral", color: "#b0b0b0" },
  { max: 75, label: "Greed", color: "#8ad03b" },
  { max: 100, label: "Extreme Greed", color: "#00d26a" },
];

function zoneOf(score: number) {
  return ZONES.find((z) => score <= z.max) ?? ZONES[ZONES.length - 1];
}

function Gauge({ score }: { score: number }) {
  const cx = 100, cy = 100, r = 80;
  const pt = (v: number, rad = r) => {
    const a = Math.PI * (1 - v / 100);
    return [cx + rad * Math.cos(a), cy - rad * Math.sin(a)];
  };
  let from = 0;
  const arcs = ZONES.map((z) => {
    const [x1, y1] = pt(from);
    const [x2, y2] = pt(z.max);
    const d = `M ${x1} ${y1} A ${r} ${r} 0 0 1 ${x2} ${y2}`;
    from = z.max;
    return <path key={z.max} d={d} stroke={z.color} strokeWidth={12} fill="none" opacity={0.85} />;
  });
  const [nx, ny] = pt(score, r - 18);
  const zone = zoneOf(score);
  return (
    <svg viewBox="0 0 200 118" className="w-full max-h-40">
      {arcs}
      <line x1={cx} y1={cy} x2={nx} y2={ny} stroke="#fff" strokeWidth={2} strokeLinecap="round" />
      <circle cx={cx} cy={cy} r={4} fill="#fff" />
      <text x={cx} y={cy + 16} textAnchor="middle" fontSize={20} fontWeight={700} fill={zone.color}>
        {Math.round(score)}
      </text>
      <text x={12} y={114} fontSize={8} fill="#808080">0</text>
      <text x={188} y={114} fontSize={8} fill="#808080" textAnchor="end">100</text>
    </svg>
  );
}

export default function FearGreedWidget() {
  const t = useT();
  const { data, error } = useQuery({
    queryKey: ["feargreed"],
    queryFn: () => apiGet<FearGreed>("/api/feargreed"),
    refetchInterval: 60_000,
  });

  if (error) return <div className="p-2 down">{t("Error:")} {(error as Error).message}</div>;
  if (!data) return <div className="p-2 dim">{t("Loading fear & greed index…")}</div>;

  const zone = zoneOf(data.score);
  const rows: Array<[string, number | null]> = [
    ["Previous close", data.previousClose],
    ["1 week ago", data.previousWeek],
    ["1 month ago", data.previousMonth],
    ["1 year ago", data.previousYear],
  ];

  return (
    <div className="p-2">
      <div dir="ltr"><Gauge score={data.score} /></div>
      <div className="text-center font-bold uppercase" style={{ color: zone.color }}>{t(zone.label)}</div>
      <table className="data-table mt-2">
        <tbody>
          {rows.map(([label, v]) => {
            const z = v === null ? null : zoneOf(v);
            return (
              <tr key={label}>
                <td>{t(label)}</td>
                <td style={{ color: z?.color }}>{z ? t(z.label) : "—"}</td>
                <td style={{ color: z?.color }}>{v === null ? "—" : fmt(v, 0)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {data.history.length > 1 && (
        <div className="h-20 mt-2" dir="ltr">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data.history} margin={{ top: 4, right: 4, bottom: 0, left: -26 }}>
              <XAxis dataKey="t" hide />
              <YAxis domain={[0, 100]} stroke="#808080" fontSize={9} ticks={[0, 25, 50, 75, 100]} />
              <Tooltip
                contentStyle={{ background: "#111", border: "1px solid #262626", fontSize: 10 }}
                labelFormatter={(v) => new Date(Number(v)).toLocaleDateString()}
                formatter={(v) => [fmt(Number(v), 0), ""]}
              />
              <Area type="monotone" dataKey="v" stroke={zone.color} fill={zone.color} fillOpacity={0.15} strokeWidth={1.5} dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
      <div className="dim text-[9px] mt-1">{t("Source: CNN Fear & Greed Index")}</div>
    </div>
  );
}
