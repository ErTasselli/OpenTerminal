"use client";

import { useEffect, useRef, useState } from "react";

/** True for a brief moment whenever `value` changes from its previous value. */
export function useFlash(value: string | number | null | undefined): boolean {
  const prev = useRef(value);
  const [flashing, setFlashing] = useState(false);

  useEffect(() => {
    if (value !== undefined && value !== null && prev.current !== value && prev.current !== undefined && prev.current !== null) {
      setFlashing(true);
      const t = setTimeout(() => setFlashing(false), 450);
      prev.current = value;
      return () => clearTimeout(t);
    }
    prev.current = value;
  }, [value]);

  return flashing;
}

/** Wraps children in a span that briefly flashes white whenever `value` changes. */
export default function Flash({
  value,
  className,
  children,
}: {
  value: string | number | null | undefined;
  className?: string;
  children: React.ReactNode;
}) {
  const flashing = useFlash(value);
  return <span className={`${className ?? ""} ${flashing ? "flash-white" : ""}`}>{children}</span>;
}
