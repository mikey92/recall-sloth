// Runs the whole pipeline (brand gate → model-name rule → Gemma) on eval/set.json.
//   node eval/run.ts                  Gemma 3 1B, exactly as the page runs it (Transformers.js, q4, greedy)
//   node eval/run.ts --ollama gemma4:e2b
//   node eval/run.ts --none           rules only: every case Gemma would see becomes "check the label"
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { buildIndex, candidates, type Recall } from "../src/recalls.ts";
import { judge, type Generate } from "../src/judge.ts";
import { nodeGemma, ollama } from "./gemma.ts";
import type { ModelKey } from "../src/llm.ts";

const args = process.argv.slice(2);
const om = args.includes("--ollama") ? args[args.indexOf("--ollama") + 1] : "";
const web = (args.includes("--web") ? args[args.indexOf("--web") + 1] : "gemma-4-e2b") as ModelKey;
const label = args.includes("--none") ? "rules-only" : om ? om.replace(/[:/]/g, "-") : `${web}-onnx`;
const generate: Generate = args.includes("--none") ? async () => "" : om ? ollama(om) : await nodeGemma(web);

const recalls = JSON.parse(readFileSync("public/recalls.json", "utf8")) as Recall[];
const ix = buildIndex(recalls);
const cases = JSON.parse(readFileSync("eval/set.json", "utf8")) as { kind: string; item: string; recall: string }[];

type Row = { kind: string; item: string; recall: string; outcome: string; why?: string; ms: number };
const rows: Row[] = [];
let calls = 0;
const counted: Generate = async (m, n) => (calls++, generate(m, n));
for (const c of cases) {
  const t0 = Date.now();
  const cand = candidates(c.item, ix, 3).find((x) => x.recall.n === c.recall);
  let outcome: string;
  let why: string | undefined;
  if (!cand) outcome = "not surfaced";
  else {
    const v = await judge(c.item, cand, counted);
    outcome = v.kind;
    why = "why" in v ? v.why : v.ids.join(", ");
  }
  rows.push({ ...c, outcome, why, ms: Date.now() - t0 });
}

const pct = (a: number, b: number) => (b ? `${Math.round((100 * a) / b)}%` : "–");
const summary: Record<string, Record<string, number>> = {};
for (const r of rows) (summary[r.kind] ??= {})[r.outcome] = (summary[r.kind][r.outcome] ?? 0) + 1;
const pos = rows.filter((r) => r.kind.startsWith("positive"));
const neg = rows.filter((r) => r.kind === "negative");
const caught = pos.filter((r) => r.outcome === "recalled" || r.outcome === "check").length;
const dismissed = pos.filter((r) => r.outcome === "not-this").length;
const falseAlarm = neg.filter((r) => r.outcome === "check" || r.outcome === "recalled").length;
console.log(label, JSON.stringify(summary));
console.log(`positives caught ${caught}/${pos.length} (${pct(caught, pos.length)}), wrongly dismissed ${dismissed} (${pct(dismissed, pos.length)}); negatives false alarm ${falseAlarm}/${neg.length} (${pct(falseAlarm, neg.length)}); model calls ${calls}`);
mkdirSync("eval/results", { recursive: true });
writeFileSync(`eval/results/${label}.json`, JSON.stringify({ label, summary, caught, dismissed, falseAlarm, positives: pos.length, negatives: neg.length, calls, rows }, null, 1));
