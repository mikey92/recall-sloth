// Which Gemma runs in the page. Both are open weights on the Hugging Face Hub, converted to ONNX.
export const MODELS = {
  "gemma-4-e2b": { id: "onnx-community/gemma-4-E2B-it-ONNX", label: "Gemma 4 E2B", mb: { q4f16: 3111, q4: 3627 } },
  "gemma-3-1b": { id: "onnx-community/gemma-3-1b-it-ONNX-GQA", label: "Gemma 3 1B", mb: { q4f16: 763, q4: 859 } },
  "gemma-3-270m": { id: "onnx-community/gemma-3-270m-it-ONNX", label: "Gemma 3 270M", mb: { q4f16: 273, q4: 323 } },
} as const;

export type ModelKey = keyof typeof MODELS;
export type { ChatMessage } from "./judge.ts";
