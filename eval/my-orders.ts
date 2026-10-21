// The author's own Amazon order emails (read in their Gmail, kept on this computer, mode 600).
// Pulls out what each email says was bought, then runs it through the same pipeline.
import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { buildIndex, candidates, type Recall } from "../src/recalls.ts";
import { judge, type Generate } from "../src/judge.ts";
import { ollama } from "./gemma.ts";

const dir = `${homedir()}/.recall-sloth`;
const orders = JSON.parse(readFileSync(`${dir}/orders-mikey9220.json`, "utf8")) as { subject: string; date: string; text: string }[];
const items: { item: string; date: string; truncated: boolean }[] = [];
let categoryOnly = 0;
for (const o of orders) {
  const names = new Set<string>();
  for (const m of `${o.subject} ${o.text}`.matchAll(/(?:ordered|order of)\s*:?\s*"([^"]{4,200})"/gi)) names.add(m[1].trim());
  if (!names.size && /item[s]?:|items? is confirmed|are confirmed|Ordered \d+ item|Ordered: .*items?$/i.test(o.subject)) categoryOnly++;
  for (const n of names) items.push({ item: n, date: o.date, truncated: n.endsWith("...") });
}
const unique = [...new Map(items.map((i) => [i.item, i])).values()];
console.log(`${orders.length} order emails → ${unique.length} named items (${unique.filter((i) => i.truncated).length} cut short by Amazon), ${categoryOnly} emails name only a category`);
const ix = buildIndex(JSON.parse(readFileSync("public/recalls.json", "utf8")) as Recall[]);
const gen: Generate = process.argv[2] ? ollama(process.argv[2]) : async () => "";
const out = [];
for (const i of unique) {
  const cs = candidates(i.item, ix, 3);
  const vs = [];
  for (const c of cs) vs.push(await judge(i.item, c, gen));
  out.push({ ...i, verdicts: vs.map((v) => ({ kind: v.kind, recall: v.recall.n, title: v.recall.title, why: "why" in v ? v.why : v.ids.join(", ") })) });
  console.log(i.date.slice(5, 16).padEnd(12), i.item.slice(0, 45).padEnd(46), vs.map((v) => `${v.kind}:${v.recall.title.slice(0, 50)}`).join(" | ") || "-");
}
writeFileSync(`${dir}/my-orders-result.json`, JSON.stringify({ orders: orders.length, categoryOnly, items: out }, null, 1), { mode: 0o600 });
