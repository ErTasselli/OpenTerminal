"use client";

import "./globals.css";

// Last-resort fallback when the root layout itself throws; replaces <html>/<body>.
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body>
        <div className="p-4 flex flex-col gap-2 items-start">
          <span className="down">Terminal error: {error.message}</span>
          <button onClick={reset} className="dim hover:text-[var(--amber)]">
            Retry
          </button>
        </div>
      </body>
    </html>
  );
}
