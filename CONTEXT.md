# OpenTerminal

A terminal-style financial dashboard: a Next.js frontend backed by an Express/SQLite API server that aggregates market data and provides an AI chat assistant.

## Language

**LLM Provider**:
A named backend for AI chat completion (`anthropic` or `ollama-cloud`), each with its own credentials, base URL, and default model.
_Avoid_: "Provider" alone — collides with the unrelated market-data providers in `server/src/providers/` (Binance, CoinGecko, Yahoo, Nasdaq, etc.), which are a different concept in a different domain.

**Active Provider**:
The single LLM Provider currently selected via the `LLM_PROVIDER` env var. Exactly one is active at a time — there is no fallback between providers and no runtime/UI selection.
_Avoid_: "Default provider" (ambiguous with the unset-env-var fallback to `anthropic`).

**Vision Model**:
The model an image-bearing chat turn is routed to under the `ollama-cloud` Active Provider, named by the separate `OLLAMA_VISION_MODEL` env var rather than the regular `LLM_MODEL`. Exactly one LLM Provider is ever active (see Active Provider); this is a second model used within that same active provider's own request, not a second provider or a runtime switch.
_Avoid_: "Vision Provider" — it isn't a second Active Provider, and the `anthropic` provider has no equivalent knob, since its models already handle images within the one model used for text.

**Tool Call**:
A single model-invoked step within a chat turn's capped agentic loop (~4-5 per turn), where the AI assistant calls a registered tool (e.g. news search) and gets a result back before continuing. Works identically under either Active Provider via the shared `tools` field on `LlmChatRequest`. Positions and Watchlist are auto-injected as plain context each turn and are not Tool Calls.

**Pending Action**:
An AI-proposed ledger write (adding, editing, or deleting a Transaction) that is held for human review rather than applied directly. The user can edit any field before confirming, or reject it outright; nothing is written to `transactions` until confirmed. Multiple Pending Actions can be open at once, and none auto-expire.

**Memory Entry**:
A distilled, AI-authored note that the assistant saves on its own to recall in later chat turns, tagged with an optional symbol and category. Raw tool output (fetched articles, quote dumps) is never saved as a Memory Entry — only the model's own summarized notes are. The user can delete a Memory Entry but cannot edit one in place.

**Audit Log Entry**:
An append-only record of one unit of AI activity — a full chat transcript, a Tool Call, a Pending Action lifecycle event, or a Memory Entry write — plus call metadata and failures. Audit Log Entries have no update or delete path, including for the user, and are retained forever.

**Vision Model**:
The vision-capable model named by `OLLAMA_VISION_MODEL`, used only under `LLM_PROVIDER=ollama-cloud` for a chat turn whose content includes an image part, in place of that provider's regular `LLM_MODEL` (which may be text-only). Not a second Active Provider — this is a per-turn model choice, decided solely by whether the turn carries an image; Anthropic's Claude models see images natively under the regular `LLM_MODEL` and never need this.

**Stored Image**:
An image attached to a chat turn, saved once to disk under `DATA_DIR/images` and referenced from then on by its content-addressed id (never re-embedded or re-sent as raw bytes). Chat history and the Audit Log's `chat`/`tool_call` entries reference a Stored Image by that id; raw image bytes are never written to the Audit Log. Only the most recent image-bearing turn (capped, like the recent-transactions snapshot auto-injected as chat context) is ever resent to an LLM Provider — an older turn's Stored Image is represented to the model as a text placeholder naming its id instead.
