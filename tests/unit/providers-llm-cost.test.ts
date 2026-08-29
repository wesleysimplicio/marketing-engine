import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { ClaudeProvider, CodexProvider, DeepSeekProvider, OllamaProvider, getLLMProvider, getLLMProviderByName } from "../../lib/providers/llm.ts";
import { estimateCost, estimateTokens, resolveUsageWithFallback } from "../../lib/providers/cost.ts";

const originalFetch = globalThis.fetch;
const envKeys = ["DRY_RUN", "ANTHROPIC_API_KEY", "OPENAI_API_KEY", "DEEPSEEK_API_KEY", "OLLAMA_HOST", "OLLAMA_MODEL", "DEEPSEEK_CHAT_INPUT_USD_PER_1K", "DEEPSEEK_CHAT_OUTPUT_USD_PER_1K"];
const originalEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));

afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const key of envKeys) originalEnv[key] === undefined ? delete process.env[key] : process.env[key] = originalEnv[key];
});

test("cost accounting selects model rates, safe overrides, and honest usage fallback", () => {
  assert.equal(estimateCost({ provider: "claude", model: "opus", tokens_in: 1000, tokens_out: 1000 }), 0.09);
  assert.equal(estimateCost({ provider: "openai", model: "gpt-5.1-mini", tokens_in: 1000, tokens_out: 1000 }), 0.0025);
  assert.equal(estimateCost({ provider: "unknown", tokens_in: 1000, tokens_out: 1000 }), 0);
  process.env.DEEPSEEK_CHAT_INPUT_USD_PER_1K = "0.5";
  process.env.DEEPSEEK_CHAT_OUTPUT_USD_PER_1K = "invalid";
  assert.equal(estimateCost({ provider: "deepseek", model: "chat", tokens_in: 1000, tokens_out: 1000 }), 0.50028);
  assert.equal(estimateTokens(""), 0);
  assert.equal(estimateTokens("12345"), 2);
  assert.deepEqual(resolveUsageWithFallback({ provider: "x", prompt: "a", output: "b", tokens_in: 3, tokens_out: 4 }), { tokens_in: 3, tokens_out: 4, used_estimate: false, source: "provider" });
  assert.deepEqual(resolveUsageWithFallback({ provider: "missing", model: "m", prompt: "12345", output: "123456789" }), {
    tokens_in: 2, tokens_out: 3, used_estimate: true, source: "tokenizer", encoding: "o200k_base", fallback_reason: "usage_missing:missing:m:model_encoding_unknown",
  });
});

test("provider factory stays mock-only by default and real providers fail closed without credentials", async () => {
  delete process.env.DRY_RUN;
  assert.match(getLLMProvider("caption").name, /deepseek/);
  assert.equal(getLLMProviderByName("does-not-exist").name, "claude");
  process.env.DRY_RUN = "false";
  await assert.rejects(new ClaudeProvider().realGenerate("p", { task: "script" }), /ANTHROPIC_API_KEY missing/);
  await assert.rejects(new CodexProvider().realGenerate("p", { task: "script" }), /OPENAI_API_KEY missing/);
  await assert.rejects(new DeepSeekProvider().realGenerate("p", { task: "script" }), /DEEPSEEK_API_KEY missing/);
});

test("OpenAI-compatible providers map requests, usage, and HTTP failures", async () => {
  process.env.OPENAI_API_KEY = "test-only";
  process.env.DEEPSEEK_API_KEY = "test-only";
  const requests: Array<{ url: string; body: any }> = [];
  globalThis.fetch = (async (input, init) => {
    requests.push({ url: String(input), body: JSON.parse(String(init?.body)) });
    return new Response(JSON.stringify({ choices: [{ message: { content: "done" } }], usage: { prompt_tokens: 5, completion_tokens: 2 } }), { status: 200 });
  }) as typeof fetch;
  const codex = await new CodexProvider().realGenerate("prompt", { task: "caption", system: "system", max_tokens: 12, temperature: 0.2 });
  const deepseek = await new DeepSeekProvider().realGenerate("prompt", { task: "script" });
  assert.equal(codex.output, "done");
  assert.equal(codex.tokens, 7);
  assert.equal(requests[0].body.messages[0].role, "system");
  assert.match(requests[1].url, /deepseek/);
  assert.equal(deepseek.used_estimate, false);

  globalThis.fetch = (async () => new Response("rate limited", { status: 429 })) as typeof fetch;
  await assert.rejects(new CodexProvider().realGenerate("p", { task: "caption" }), /HTTP 429: rate limited/);
});

test("Claude and Ollama adapters normalize successful and failed responses", async () => {
  process.env.ANTHROPIC_API_KEY = "test-only";
  globalThis.fetch = (async () => new Response(JSON.stringify({
    content: [{ type: "text", text: "hello" }, { type: "tool" }],
    usage: { input_tokens: 4, output_tokens: 2, cache_read_input_tokens: 1 },
  }), { status: 200 })) as typeof fetch;
  const claude = await new ClaudeProvider().realGenerate("p", { task: "humanization", system: "s" });
  assert.equal(claude.output, "hello");
  assert.equal(claude.cache_status, "hit");

  process.env.OLLAMA_HOST = "http://local///";
  process.env.OLLAMA_MODEL = "tiny";
  globalThis.fetch = (async () => new Response(JSON.stringify({ message: { content: "local" }, prompt_eval_count: 3, eval_count: 2 }), { status: 200 })) as typeof fetch;
  const ollama = await new OllamaProvider().realGenerate("p", { task: "caption", system: "s" });
  assert.equal(ollama.output, "local");
  assert.equal(ollama.tokens, 5);

  globalThis.fetch = (async () => { throw new Error("offline"); }) as typeof fetch;
  await assert.rejects(new OllamaProvider().realGenerate("p", { task: "caption" }), /could not reach.*offline/);
});
