import express from "express";
import cors from "cors";
import { marketRouter } from "./routes/market.js";
import { portfolioRouter } from "./routes/portfolio.js";
import { aiRouter } from "./routes/ai.js";
import { allStats } from "./providers/registry.js";

const app = express();
app.use(cors());
app.use(express.json());

app.use("/api", marketRouter);
app.use("/api/portfolios", portfolioRouter);
app.use("/api/ai", aiRouter);

app.get("/api/status", (_req, res) => {
  res.json({
    ok: true,
    time: new Date().toISOString(),
    providers: allStats(),
    ai: Boolean(process.env.ANTHROPIC_API_KEY),
  });
});

const PORT = Number(process.env.API_PORT ?? 4000);
app.listen(PORT, () => {
  console.log(`OpenTerminal API listening on http://localhost:${PORT}`);
});
