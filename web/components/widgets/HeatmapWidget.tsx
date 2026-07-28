"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import * as d3 from "d3";
import { apiGet } from "../../lib/api";
import { useTerminal } from "../../store/terminal";

type Cell = { symbol: string; name: string | null; sector: string; marketCap: number | null; changePercent: number | null };

export default function HeatmapWidget() {
  const ref = useRef<HTMLDivElement>(null);
  const setActiveSymbol = useTerminal((s) => s.setActiveSymbol);
  const { data, error } = useQuery({
    queryKey: ["heatmap"],
    queryFn: () => apiGet<Cell[]>("/api/heatmap"),
    refetchInterval: 3_000,
  });

  useEffect(() => {
    const el = ref.current;
    if (!el || !data) return;

    const render = () => {
      const width = el.clientWidth;
      const height = el.clientHeight;
      if (width === 0 || height === 0) return;
      el.innerHTML = "";

      const valid = data.filter((d) => d.marketCap && d.changePercent !== null);
      type Node = { name: string; children?: Node[]; data?: Cell };
      const root = d3
        .hierarchy<Node>({
          name: "root",
          children: [...d3.group(valid, (d) => d.sector)].map(([sector, items]) => ({
            name: sector,
            children: items.map((d) => ({ name: d.symbol, data: d })),
          })),
        })
        .sum((d) => d.data?.marketCap ?? 0)
        .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));

      d3.treemap<Node>().size([width, height]).paddingInner(1).paddingTop(12)(root);

      const color = (chg: number) => {
        const clamped = Math.max(-3, Math.min(3, chg));
        return clamped >= 0
          ? d3.interpolateRgb("#1a1a1a", "#00c853")(clamped / 3)
          : d3.interpolateRgb("#1a1a1a", "#ff3d3d")(-clamped / 3);
      };

      const svg = d3.select(el).append("svg").attr("width", width).attr("height", height);

      // Clip each sector label to its own column so long names never bleed
      // into the neighboring sector (the visible cause of overlapping text).
      const sectorClipId = (name: string) => `sector-clip-${name.replace(/[^a-zA-Z0-9]/g, "")}`;

      svg
        .selectAll("clipPath.sector-clip")
        .data(root.children ?? [])
        .join("clipPath")
        .attr("class", "sector-clip")
        .attr("id", (d: any) => sectorClipId(d.data.name))
        .append("rect")
        .attr("x", (d: any) => d.x0)
        .attr("y", (d: any) => d.y0)
        .attr("width", (d: any) => Math.max(0, d.x1 - d.x0 - 4))
        .attr("height", 12);

      svg
        .selectAll("text.sector")
        .data((root.children ?? []).filter((d: any) => d.x1 - d.x0 > 20))
        .join("text")
        .attr("class", "sector")
        .attr("x", (d: any) => d.x0 + 3)
        .attr("y", (d: any) => d.y0 + 9)
        .attr("clip-path", (d: any) => `url(#${sectorClipId(d.data.name)})`)
        .attr("fill", "#808080")
        .attr("font-size", 8)
        .text((d: any) => d.data.name.toUpperCase());

      const leaf = svg
        .selectAll("g.leaf")
        .data(root.leaves())
        .join("g")
        .attr("class", "leaf")
        .attr("transform", (d: any) => `translate(${d.x0},${d.y0})`)
        .style("cursor", "pointer")
        .on("click", (_e, d: any) => setActiveSymbol(d.data.data.symbol));

      leaf
        .append("rect")
        .attr("width", (d: any) => Math.max(0, d.x1 - d.x0))
        .attr("height", (d: any) => Math.max(0, d.y1 - d.y0))
        .attr("fill", (d: any) => color(d.data.data.changePercent))
        .append("title")
        .text((d: any) => `${d.data.data.symbol} ${d.data.data.name ?? ""}: ${d.data.data.changePercent?.toFixed(2)}%`);

      leaf
        .filter((d: any) => d.x1 - d.x0 > 32 && d.y1 - d.y0 > 18)
        .append("text")
        .attr("x", 3)
        .attr("y", 11)
        .attr("fill", "#fff")
        .attr("font-size", 9)
        .attr("font-weight", "bold")
        .text((d: any) => d.data.data.symbol);

      leaf
        .filter((d: any) => d.x1 - d.x0 > 40 && d.y1 - d.y0 > 30)
        .append("text")
        .attr("x", 3)
        .attr("y", 22)
        .attr("fill", "#ddd")
        .attr("font-size", 8)
        .text((d: any) => `${d.data.data.changePercent >= 0 ? "+" : ""}${d.data.data.changePercent.toFixed(2)}%`);
    };

    render();
    const obs = new ResizeObserver(render);
    obs.observe(el);
    return () => obs.disconnect();
  }, [data, setActiveSymbol]);

  if (error) return <div className="p-2 down">Error: {(error as Error).message}</div>;
  if (!data) return <div className="p-2 dim">Loading heatmap…</div>;
  return <div ref={ref} className="w-full h-full" />;
}
