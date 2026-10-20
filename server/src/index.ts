import { createApp } from "./app.js";
import { startAlertEngine } from "./alerts.js";
import { startPaperEngine } from "./paper.js";
import { getQuotes } from "./routes/market.js";

const app = createApp();
// Evaluates price alerts every 5s against the shared quote cache.
startAlertEngine(getQuotes);
// Fills open paper limit/stop orders every 5s.
startPaperEngine(getQuotes);

const PORT = Number(process.env.API_PORT ?? 4000);
// Bind to localhost by default so cloning and running this never exposes an
// unauthenticated-by-default API to the network. Set API_HOST=0.0.0.0 (and
// API_KEY + WEB_ORIGIN) to intentionally expose it beyond this machine.
const HOST = process.env.API_HOST ?? "127.0.0.1";
app.listen(PORT, HOST, () => {
  console.log(`OpenTerminal API listening on http://${HOST}:${PORT}`);
});
