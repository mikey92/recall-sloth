// Builds the evaluation set from real CPSC product names only. No invented products.
//  - positive: a recalled product's own name vs. its recall (and the same name cut short the way
//    Amazon's order emails cut it: "Zinus Memory Foam 10 Inch...")
//  - negative: another product of the SAME brand, recalled for something else, vs. this recall
//    (IKEA lamp vs IKEA dresser recall). Same brand is what makes it hard.
import { readFileSync, writeFileSync } from "node:fs";
import { tokens, type Recall } from "../src/recalls.ts";

const recalls = JSON.parse(readFileSync("public/recalls.json", "utf8")) as Recall[];
const brandKey = (r: Recall) => tokens(r.brand).slice(0, 2).join(" ");
const byBrand = new Map<string, Recall[]>();
for (const r of recalls) {
  const k = brandKey(r);
  if (k && r.products[0]) byBrand.set(k, [...(byBrand.get(k) ?? []), r]);
}
// Brands with recalls of different kinds of product.
const typeOf = (r: Recall) => (r.types[0] ?? "").toLowerCase();
const brands = [...byBrand.entries()].filter(([, rs]) => new Set(rs.map(typeOf)).size >= 2).sort((a, b) => b[1].length - a[1].length);

// Deterministic shuffle so the set is reproducible.
let seed = 26;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
const cut = (s: string) => (s.length > 30 ? s.slice(0, 28).replace(/\s+\S*$/, "") + "..." : s);

type Case = { kind: "positive" | "positive-cut" | "negative"; item: string; recall: string; other?: string; brand: string };
const cases: Case[] = [];
const carriesBrand = (r: Recall) => tokens(r.products[0] ?? "").some((t) => tokens(r.brand).includes(t));
// Positives: things people actually bought online. 150 recalls sold on Amazon, named the way the maker names them.
const online = recalls.filter((r) => /amazon/i.test(r.sold) && carriesBrand(r)).sort(() => rand() - 0.5).slice(0, 150);
for (const r of online) {
  cases.push({ kind: "positive", item: r.products[0], recall: r.n, brand: brandKey(r) });
  if (r.products[0].length > 30) cases.push({ kind: "positive-cut", item: cut(r.products[0]), recall: r.n, brand: brandKey(r) });
}
// Hard negatives: the same brand's other recalled product, of a different kind, against this recall.
for (const [brand, rs] of brands) {
  for (const r of rs.filter(carriesBrand)) {
    const other = rs.find((o) => o.n !== r.n && typeOf(o) !== typeOf(r) && carriesBrand(o) && !tokens(o.products[0]).every((t) => tokens(r.products[0]).includes(t)) && !tokens(o.products[0]).some((t) => /\d/.test(t) && tokens(r.products[0]).includes(t)));
    if (other) cases.push({ kind: "negative", item: other.products[0], recall: r.n, other: other.n, brand });
  }
}
writeFileSync("eval/set.json", JSON.stringify(cases, null, 1));
const count = (k: string) => cases.filter((c) => c.kind === k).length;
console.log(`${cases.length} cases from ${new Set(cases.map((c) => c.brand)).size} brands: ${count("positive")} positive, ${count("positive-cut")} cut short, ${count("negative")} same-brand negative`);
