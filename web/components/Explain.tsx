"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { lookup } from "../lib/glossary";
import { useTerminal } from "../store/terminal";

/**
 * Wraps a label with a beginner explanation from lib/glossary.ts. Hover or
 * keyboard-focus shows a popover. With LEARN mode off (TopBar toggle) or no
 * glossary entry, it renders the label untouched, so experienced users see no
 * change. The popover is portalled to <body> and fixed-positioned, so widget
 * panels with overflow:auto can't clip it.
 */
/** `nested`: inside a button, the button already takes focus, so the label gets no tab stop of its own. */
export default function Explain({ term, children, className = "", nested = false }: { term?: string; children: ReactNode; className?: string; nested?: boolean }) {
  const learn = useTerminal((s) => s.learnMode);
  const entry = lookup(term ?? (typeof children === "string" ? children : ""));
  const id = useId();
  const anchor = useRef<HTMLSpanElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; above: boolean } | null>(null);

  useEffect(() => {
    if (!pos) return;
    const close = (e: KeyboardEvent) => e.key === "Escape" && setPos(null);
    const hide = () => setPos(null);
    window.addEventListener("keydown", close);
    window.addEventListener("scroll", hide, true);
    return () => {
      window.removeEventListener("keydown", close);
      window.removeEventListener("scroll", hide, true);
    };
  }, [pos]);

  if (!learn || !entry) return <span className={className}>{children}</span>;

  const show = () => {
    const r = anchor.current?.getBoundingClientRect();
    if (!r) return;
    const width = 280;
    const left = Math.min(Math.max(8, r.left), window.innerWidth - width - 8);
    const above = r.bottom + 170 > window.innerHeight;
    setPos({ left, top: above ? r.top - 6 : r.bottom + 6, above });
  };

  return (
    <>
      <span
        ref={anchor}
        tabIndex={nested ? undefined : 0}
        aria-describedby={pos ? id : undefined}
        onMouseEnter={show}
        onMouseLeave={() => setPos(null)}
        onFocus={show}
        onBlur={() => setPos(null)}
        className={`underline decoration-dotted decoration-[#555] underline-offset-2 cursor-help ${className}`}
      >
        {children}
      </span>
      {pos &&
        createPortal(
          <div
            id={id}
            role="tooltip"
            className="fixed z-[100] w-[280px] bg-[#0f0f0f] border border-[var(--amber)] p-2 text-[11px] leading-snug shadow-xl pointer-events-none"
            style={{ left: pos.left, top: pos.top, transform: pos.above ? "translateY(-100%)" : undefined }}
          >
            <div className="amber font-bold mb-1">{entry.title}</div>
            <div className="text-[#e0e0e0]">{entry.what}</div>
            <div className="text-[#a8a8a8] mt-1">{entry.why}</div>
            {entry.tip && <div className="text-[#8fb3ff] mt-1">Tip: {entry.tip}</div>}
          </div>,
          document.body
        )}
    </>
  );
}
