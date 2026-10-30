"use client";

import { useEffect, useRef, useState } from "react";
import {
  CandlestickSeries, createChart, createSeriesMarkers,
  type IChartApi, type ISeriesApi, type ISeriesMarkersPluginApi, type Time, type UTCTimestamp,
} from "lightweight-charts";
import { apiGet, fmt, pctClass } from "../../lib/api";
import { finish, MYSTERY_SYMBOLS, newGame, score, step, visibleBars, type Bar, type Game, type Intent } from "../../lib/replay";
import { useTerminal } from "../../store/terminal";
import Explain from "../Explain";

type Setup = { symbol: string; mystery: boolean };
const ts = (t: number) => t as UTCTimestamp;
const day = (t: number) => new Date(t * 1000).toISOString().slice(0, 10);
const signed = (n: number) => `${n >= 0 ? "+" : ""}${fmt(n)}%`;

function ReplayChart({ game, mystery }: { game: Game; mystery: boolean }) {
  const el = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  const series = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const markers = useRef<ISeriesMarkersPluginApi<Time> | null>(null);

  useEffect(() => {
    if (!el.current) return;
    const c = createChart(el.current, {
      autoSize: true,
      layout: { background: { color: "#0a0a0a" }, textColor: "#808080", fontSize: 10, attributionLogo: false },
      grid: { vertLines: { color: "#1a1a1a" }, horzLines: { color: "#1a1a1a" } },
      rightPriceScale: { borderColor: "#262626" },
      // rightOffset keeps the newest candle (and its BUY/SELL marker text) off the edge.
      timeScale: { borderColor: "#262626", rightOffset: 6 },
    });
    series.current = c.addSeries(CandlestickSeries, {
      upColor: "#00c853", downColor: "#ff3d3d", borderVisible: false, wickUpColor: "#00c853", wickDownColor: "#ff3d3d",
    });
    markers.current = createSeriesMarkers(series.current, []);
    chart.current = c;
    return () => {
      c.remove();
      chart.current = null;
    };
  }, []);

  useEffect(() => {
    const bars = visibleBars(game, mystery);
    series.current?.setData(bars.map((b: Bar) => ({ time: ts(b.time), open: b.open, high: b.high, low: b.low, close: b.close })));
    markers.current?.setMarkers(
      game.fills.map((f) => ({
        time: ts(game.candles[f.index].time),
        position: f.side === "buy" ? "belowBar" : "aboveBar",
        color: f.side === "buy" ? "#00c853" : "#ff3d3d",
        shape: f.side === "buy" ? "arrowUp" : "arrowDown",
        text: f.side.toUpperCase(),
      }))
    );
    // Dates stay hidden until the reveal in mystery mode.
    chart.current?.applyOptions({ timeScale: { visible: !mystery || game.done } });
    chart.current?.timeScale().scrollToRealTime();
  }, [game, mystery]);

  return <div ref={el} className="flex-1 min-h-0" />;
}

export default function ReplayWidget() {
  const activeSymbol = useTerminal((s) => s.activeSymbol);
  const setActiveSymbol = useTerminal((s) => s.setActiveSymbol);
  const [setup, setSetup] = useState<Setup | null>(null);
  const [game, setGame] = useState<Game | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  const start = async (s: Setup) => {
    setError(null);
    setGame(null);
    setPlaying(false);
    setSetup(s);
    try {
      const candles = await apiGet<Bar[]>(`/api/history/${encodeURIComponent(s.symbol)}?range=5Y`);
      setGame(newGame(candles));
      setTimeout(() => box.current?.focus(), 0);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const act = (intent: Intent) => setGame((g) => (g ? step(g, intent) : g));

  useEffect(() => {
    if (!playing || !game || game.done) return;
    const id = setInterval(() => setGame((g) => (g && !g.done ? step(g) : g)), 700);
    return () => clearInterval(id);
  }, [playing, game?.done, game]);

  if (!setup || (!game && !error)) {
    return (
      <div className="p-3 space-y-2 text-[11px]">
        <div className="amber font-bold"><Explain term="replay">TRADE THE PAST</Explain></div>
        <div className="dim">
          A real chart plays one day at a time. Decide BUY, SELL or just NEXT. Orders fill at the next day&apos;s open,
          and you&apos;re scored against <Explain term="buyHold">buy and hold</Explain>.
        </div>
        {setup && !game && !error ? (
          <div className="dim">Loading history…</div>
        ) : (
          <div className="flex gap-2 flex-wrap">
            <button className="term-btn active" onClick={() => start({ symbol: MYSTERY_SYMBOLS[Math.floor(Math.random() * MYSTERY_SYMBOLS.length)], mystery: true })}>
              MYSTERY STOCK
            </button>
            <button className="term-btn" onClick={() => start({ symbol: activeSymbol, mystery: false })}>
              PRACTISE ON {activeSymbol}
            </button>
          </div>
        )}
        <div className="dim text-[10px]">Mystery mode hides the name, dates and real prices (rebased to 100) until the end, so hindsight can&apos;t help.</div>
      </div>
    );
  }
  if (error) {
    return (
      <div className="p-3 space-y-2">
        <div className="down">Couldn&apos;t start: {error}</div>
        <button className="term-btn" onClick={() => setSetup(null)}>BACK</button>
      </div>
    );
  }

  const g = game!;
  const mystery = setup.mystery;
  const s = score(g);
  const bar = g.candles[g.cursor];
  const k = mystery && !g.done ? 100 / g.candles[g.start].close : 1;
  const equityNow = g.cash + g.shares * bar.close;

  return (
    <div
      ref={box}
      tabIndex={0}
      className="flex flex-col h-full outline-none text-[11px]"
      onKeyDown={(e) => {
        if (g.done || e.target instanceof HTMLInputElement) return;
        const key = e.key.toLowerCase();
        if (key === "b") act("buy");
        else if (key === "s") act("sell");
        else if (key === "n" || key === "arrowright") act(null);
        else return;
        e.preventDefault();
      }}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-2 py-1 border-b border-[var(--border)] shrink-0">
        <span className="amber font-bold">{mystery && !g.done ? "MYSTERY STOCK" : setup.symbol}</span>
        <span className="dim">day {s.bars}/{g.end - g.start}</span>
        <span>price {fmt(bar.close * k)}</span>
        <span>{g.shares > 0 ? <span className="up">holding {g.shares} sh</span> : <span className="dim">in cash</span>}</span>
        <span>
          <Explain className="dim">Equity</Explain> ${fmt(equityNow)} <span className={pctClass(s.returnPct)}>({signed(s.returnPct)})</span>
        </span>
      </div>

      <ReplayChart game={g} mystery={mystery} />

      {!g.done ? (
        <div className="flex gap-1 p-1 items-center shrink-0">
          <button className="term-btn up" disabled={g.shares > 0} onClick={() => act("buy")} title="B">BUY</button>
          <button className="term-btn down" disabled={g.shares === 0} onClick={() => act("sell")} title="S">SELL</button>
          <button className="term-btn" onClick={() => act(null)} title="N or →">NEXT ▶</button>
          <button className={`term-btn ${playing ? "active" : ""}`} onClick={() => setPlaying(!playing)}>{playing ? "PAUSE" : "PLAY"}</button>
          <button className="term-btn ml-auto" onClick={() => { setPlaying(false); setGame(finish(g)); }}>FINISH</button>
          <span className="dim text-[10px]">keys: B buy · S sell · N next</span>
        </div>
      ) : (
        <div className="p-2 border-t border-[var(--border)] shrink-0 space-y-1">
          <div>
            It was <span className="amber font-bold cursor-pointer" onClick={() => setActiveSymbol(setup.symbol)}>{setup.symbol}</span>,{" "}
            {day(g.candles[g.start].time)} → {day(g.candles[g.cursor].time)}.
          </div>
          <div className="flex flex-wrap gap-x-4">
            <span>You: <b className={pctClass(s.returnPct)}>{signed(s.returnPct)}</b></span>
            <span><Explain term="buyHold">Buy &amp; hold</Explain>: <b className={pctClass(s.buyHoldPct)}>{signed(s.buyHoldPct)}</b></span>
            <span>Edge: <b className={pctClass(s.edgePct)}>{signed(s.edgePct)}</b></span>
            <span>Trades: {s.trades}{s.winRate !== null ? ` (${fmt(s.winRate * 100, 0)}% winners)` : ""}</span>
            <span>Worst drop: <span className="down">−{fmt(s.maxDrawdownPct)}%</span></span>
          </div>
          <div className="dim text-[10px]">
            {s.edgePct >= 0
              ? "You beat buy-and-hold this time. Try a few more: one result can be luck."
              : "Buy-and-hold won this round. That's common: most active traders trail it over time."}
          </div>
          <div className="flex gap-2">
            <button className="term-btn active" onClick={() => start({ ...setup, symbol: setup.mystery ? MYSTERY_SYMBOLS[Math.floor(Math.random() * MYSTERY_SYMBOLS.length)] : setup.symbol })}>
              PLAY AGAIN
            </button>
            <button className="term-btn" onClick={() => { setSetup(null); setGame(null); }}>CHANGE MODE</button>
          </div>
        </div>
      )}
    </div>
  );
}
