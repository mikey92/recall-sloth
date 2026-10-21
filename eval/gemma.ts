// The same Gemma the page runs (Transformers.js, q4, greedy), but in Node on the CPU, so the eval
// measures exactly what a visitor gets. --ollama <model> swaps in a bigger local model for comparison.
import type { ChatMessage, Generate } from "../src/judge.ts";
import { MODELS, type ModelKey } from "../src/llm.ts";

export async function nodeGemma(key: ModelKey = "gemma-4-e2b"): Promise<Generate> {
  const { pipeline } = await import("@huggingface/transformers");
  const generator = await pipeline("text-generation", MODELS[key].id, { dtype: "q4", device: "cpu" });
  return async (messages: ChatMessage[], maxNewTokens: number) => {
    const out = (await generator(messages, { max_new_tokens: maxNewTokens, do_sample: false })) as { generated_text: ChatMessage[] }[];
    const reply = out[0].generated_text.at(-1);
    return typeof reply?.content === "string" ? reply.content : "";
  };
}

export function ollama(model: string): Generate {
  return async (messages, maxNewTokens) => {
    const r = await fetch("http://127.0.0.1:11434/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, messages, stream: false, think: false, options: { temperature: 0, num_predict: maxNewTokens } }),
    });
    return ((await r.json()) as { message: { content: string } }).message.content;
  };
}
