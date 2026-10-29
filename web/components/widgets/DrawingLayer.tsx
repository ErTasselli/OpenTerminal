"use client";

import type { IChartApi, ISeriesApi, Logical } from "lightweight-charts";
import { useEffect, useRef, useState } from "react";
import { fmt } from "../../lib/api";
import { logicalToTime, timeToLogical } from "../../lib/chartCoords";
import { POINTS_NEEDED, useDrawings, type Drawing, type DrawingKind, type DrawingPoint } from "../../store/drawings";

const FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];

type Props = {
  chart: IChartApi;
  series: ISeriesApi<any>;
  candles: Array<{ time: number }>;
  symbol: string;
  tool: DrawingKind | null;
  color: string;
  selected: string | null;
  onSelect: (id: string | null) => void;
  onToolDone: () => void;
};

/** SVG overlay: renders saved drawings in chart coordinates and captures clicks
 * while a drawing tool is armed. It stays transparent to the mouse otherwise,
 * so the chart still pans/zooms (only the drawn shapes themselves are clickable). */
export default function DrawingLayer({ chart, series, candles, symbol, tool, color, selected, onSelect, onToolDone }: Props) {
  const drawings = useDrawings((s) => s.bySymbol[symbol]) ?? [];
  const add = useDrawings((s) => s.add);
  const [pending, setPending] = useState<DrawingPoint[]>([]);
  const [hover, setHover] = useState<DrawingPoint | null>(null);
  const [, setFrame] = useState(0);
  const svgRef = useRef<SVGSVGElement>(null);
  // Active edit gesture: drag one handle ("point"), or the whole shape ("move").
  const dragRef = useRef<{ id: string; idx: number | null; start: DrawingPoint; orig: DrawingPoint[]; sx: number; sy: number; moved: boolean } | null>(null);
  const justDragged = useRef(false);

  // Re-render when the chart's view changes. lightweight-charts has no event for
  // vertical (price) scaling, so poll a cheap signature once per frame.
  useEffect(() => {
    let raf = 0;
    let last = "";
    const tick = () => {
      const r = chart.timeScale().getVisibleLogicalRange();
      const sig = `${r?.from}|${r?.to}|${series.priceToCoordinate(100)}|${series.priceToCoordinate(200)}|${svgRef.current?.clientWidth}`;
      if (sig !== last) {
        last = sig;
        setFrame((f) => f + 1);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [chart, series]);

  useEffect(() => {
    setPending([]);
    setHover(null);
  }, [tool, symbol]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setPending([]);
        onToolDone();
      }
      if ((e.key === "Delete" || e.key === "Backspace") && selected && !(e.target instanceof HTMLInputElement)) {
        useDrawings.getState().remove(symbol, selected);
        onSelect(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected, symbol, onSelect, onToolDone]);

  const toX = (time: number) => chart.timeScale().logicalToCoordinate(timeToLogical(candles, time) as Logical);
  const toY = (price: number) => series.priceToCoordinate(price);
  const toPoint = (e: { clientX: number; clientY: number }): DrawingPoint | null => {
    const box = svgRef.current!.getBoundingClientRect();
    const logical = chart.timeScale().coordinateToLogical(e.clientX - box.left);
    const price = series.coordinateToPrice(e.clientY - box.top);
    if (logical === null || price === null) return null;
    return { time: Math.round(logicalToTime(candles, logical)), price };
  };

  const startDrag = (e: React.MouseEvent, id: string, idx: number | null) => {
    if (tool || e.button !== 0) return;
    const d = drawings.find((x) => x.id === id);
    const start = toPoint(e);
    if (!d || !start) return;
    e.stopPropagation();
    e.preventDefault();
    dragRef.current = { id, idx, start, orig: d.points, sx: e.clientX, sy: e.clientY, moved: false };
    const onMove = (ev: MouseEvent) => {
      const g = dragRef.current;
      if (!g) return;
      if (!g.moved && Math.hypot(ev.clientX - g.sx, ev.clientY - g.sy) < 3) return;
      g.moved = true;
      const cur = toPoint(ev);
      if (!cur) return;
      const dt = cur.time - g.start.time;
      const dp = cur.price - g.start.price;
      const points =
        g.idx === null
          ? g.orig.map((p) => ({ time: Math.round(p.time + dt), price: p.price + dp }))
          : g.orig.map((p, i) => (i === g.idx ? { time: cur.time, price: cur.price } : p));
      useDrawings.getState().update(symbol, g.id, { points });
    };
    const onUp = () => {
      justDragged.current = !!dragRef.current?.moved;
      dragRef.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      setTimeout(() => (justDragged.current = false), 0);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const click = (e: React.MouseEvent) => {
    if (!tool) return;
    const p = toPoint(e);
    if (!p) return;
    const next = [...pending, p];
    if (next.length >= POINTS_NEEDED[tool]) {
      add(symbol, tool, next, color);
      setPending([]);
      setHover(null);
      onToolDone();
    } else setPending(next);
  };

  const width = svgRef.current?.clientWidth ?? 0;
  const height = svgRef.current?.clientHeight ?? 0;

  const render = (d: Pick<Drawing, "kind" | "points" | "color">, key: string, id?: string, preview = false) => {
    const pts = d.points.map((p) => ({ x: toX(p.time), y: toY(p.price), price: p.price }));
    if (pts.some((p) => p.y === null || p.x === null)) return null;
    const [a, b] = pts as Array<{ x: number; y: number; price: number }>;
    const isSel = id !== undefined && id === selected;
    const common = {
      stroke: d.color,
      strokeWidth: isSel ? 2.5 : 1.5,
      strokeDasharray: preview ? "4 3" : undefined,
      style: { pointerEvents: preview || tool ? ("none" as const) : ("stroke" as const), cursor: "pointer" },
      onClick: (ev: React.MouseEvent) => {
        ev.stopPropagation();
        if (id && !justDragged.current) onSelect(id === selected ? null : id);
      },
      onMouseDown: (ev: React.MouseEvent) => {
        if (id && isSel) startDrag(ev, id, null);
      },
    };
    // Invisible fat stroke so thin lines are easy to grab.
    const hit = (k: string, x1: number, y1: number, x2: number, y2: number) =>
      id ? (
        <line
          key={k}
          x1={x1} y1={y1} x2={x2} y2={y2}
          stroke="transparent"
          strokeWidth={14}
          style={{ pointerEvents: tool ? "none" : "stroke", cursor: isSel ? "move" : "pointer" }}
          onClick={common.onClick}
          onMouseDown={common.onMouseDown}
        />
      ) : null;
    switch (d.kind) {
      case "trend":
        return b ? (
          <g key={key}>
            <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} {...common} />
            {hit("hit", a.x, a.y, b.x, b.y)}
          </g>
        ) : null;
      case "hline":
        return (
          <g key={key}>
            <line x1={0} y1={a.y} x2={width} y2={a.y} {...common} />
            {hit("hit", 0, a.y, width, a.y)}
            <text x={width - 4} y={a.y - 3} textAnchor="end" fill={d.color} fontSize={10}>{fmt(a.price)}</text>
          </g>
        );
      case "vline":
        return (
          <g key={key}>
            <line x1={a.x} y1={0} x2={a.x} y2={height} {...common} />
            {hit("hit", a.x, 0, a.x, height)}
          </g>
        );
      case "rect":
        return b ? (
          <rect
            key={key}
            x={Math.min(a.x, b.x)}
            y={Math.min(a.y, b.y)}
            width={Math.abs(b.x - a.x)}
            height={Math.abs(b.y - a.y)}
            fill={d.color}
            fillOpacity={0.12}
            {...common}
            style={{ ...common.style, pointerEvents: preview || tool ? "none" : "visiblePainted" }}
          />
        ) : null;
      case "fib": {
        if (!b) return null;
        const left = Math.min(a.x, b.x);
        const right = Math.max(a.x, b.x, left + 60);
        return (
          <g key={key}>
            {FIB_LEVELS.map((lvl) => {
              const price = b.price + (a.price - b.price) * lvl;
              const y = toY(price);
              if (y === null) return null;
              return (
                <g key={lvl}>
                  <line x1={left} y1={y} x2={right} y2={y} {...common} strokeWidth={lvl === 0 || lvl === 1 ? common.strokeWidth : 1} strokeOpacity={0.8} />
                  {hit(`hit${lvl}`, left, y, right, y)}
                  <text x={right + 3} y={y + 3} fill={d.color} fontSize={9} style={{ pointerEvents: "none" }}>{lvl} · {fmt(price)}</text>
                </g>
              );
            })}
            <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={d.color} strokeDasharray="3 3" strokeWidth={1} style={{ pointerEvents: "none" }} />
          </g>
        );
      }
    }
  };

  const previewDrawing =
    tool && pending.length > 0 && hover ? render({ kind: tool, points: [...pending, hover], color }, "preview", undefined, true) : null;
  const hoverGuide =
    tool && POINTS_NEEDED[tool] === 1 && hover ? render({ kind: tool, points: [hover], color }, "guide", undefined, true) : null;

  return (
    <svg
      ref={svgRef}
      className="absolute inset-0 w-full h-full"
      style={{ pointerEvents: tool ? "auto" : "none", cursor: tool ? "crosshair" : undefined, zIndex: 5 }}
      onClick={click}
      onMouseMove={(e) => tool && setHover(toPoint(e))}
      onMouseLeave={() => setHover(null)}
    >
      {drawings.map((d) => render(d, d.id, d.id))}
      {!tool && drawings.filter((d) => d.id === selected).flatMap((d) =>
        d.points.map((pt, i) => {
          const x = toX(pt.time);
          const y = toY(pt.price);
          if (x === null || y === null) return null;
          return (
            <circle
              key={`${d.id}-h${i}`}
              cx={x}
              cy={y}
              r={5}
              fill="#000"
              stroke={d.color}
              strokeWidth={2}
              style={{ pointerEvents: "auto", cursor: "grab" }}
              onMouseDown={(e) => startDrag(e, d.id, i)}
              onClick={(e) => e.stopPropagation()}
            />
          );
        })
      )}
      {previewDrawing}
      {hoverGuide}
    </svg>
  );
}
