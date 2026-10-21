// The recall list and the cheap part of matching: no model involved. Most things you own never
// reach Gemma, because no recall shares a brand with them.

export interface Recall {
  n: string; // CPSC recall number
  date: string;
  title: string;
  brand: string; // the recalling company, from the title
  products: string[];
  types: string[];
  hazard: string;
  remedy: string;
  sold: string;
  ids: string[]; // model numbers, UPCs and the like, as printed in the notice
  check: string[]; // the notice's own sentences on how to tell if yours is affected
  desc: string;
  url: string;
  img: string;
}

const STOP = new Set(
  "a an and or the of for to in on with by from at as is are be this that it its your you our new set pack kit inch inches in. ft oz lb lbs cm mm pcs pc piece pieces count size black white gray grey blue red green pink large small mini portable adjustable premium upgraded 2024 2025 2026 2023 2022 2021 2020 inc llc ltd co corp company corporation group usa us international products product brand brands recalls recall due risk hazard".split(" "),
);

export function tokens(s: string): string[] {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ™®©]/g, "")
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1 && !STOP.has(t))
    .map((t) => (t.length > 4 && t.endsWith("s") && !t.endsWith("ss") ? t.slice(0, -1) : t));
}

/** "3M Company Recalls Scotch Thermal Laminators Due to…" → "3M Company". */
export function brandFromTitle(title: string): string {
  const m = title.replace(/\s+/g, " ").match(/^(.+?),?\s+(?:Recalls?|Announces Recall|Expands Recall|Recalling)\b/i);
  return (m?.[1] ?? "").replace(/,? (of|in) [A-Z][^,]*(,[^,]*)?$/, "").trim();
}

/** "…Due to Risk of Serious Injury or Death from Fire Hazard" → "Risk of Serious Injury or Death from Fire Hazard". */
export function hazardFromTitle(title: string): string {
  const m = title.match(/\bDue to (.+?)(?:;|$)/i);
  return (m?.[1] ?? "").trim();
}

/** Model numbers, UPCs, SKUs: tokens that mix letters and digits, or long digit runs with dashes. */
export function identifiers(desc: string): string[] {
  const out = new Set<string>();
  for (const raw of desc.match(/\b[A-Z0-9][A-Z0-9-/.]{2,}[A-Z0-9]\b/gi) ?? []) {
    const t = raw.replace(/[./]$/, "");
    const letters = /[A-Z]/i.test(t);
    const digits = (t.match(/\d/g) ?? []).length;
    if (!digits) continue;
    if (/^\d{4}$/.test(t) && +t > 1900 && +t < 2100) continue; // years
    if (/^\d+(\.\d+)?$/.test(t) && digits < 6) continue; // sizes, counts
    if (/^\d+(\.\d+)?(in|mm|cm|ft|oz|lb|lbs|v|w|mah|ah|wh|kg|g|ml|l)$/i.test(t)) continue; // units
    if (/^\d+-(in-\d+|[A-Z]+)$/i.test(t)) continue; // "6-drawer", "3-in-1", "10-pack"
    if (letters || digits >= 6) out.add(t.toUpperCase());
  }
  return [...out].slice(0, 40);
}

/** The notice's sentences that say how to tell an affected unit from a fine one. */
export function checkSentences(desc: string): string[] {
  const s = desc.split(/(?<=[.!?])\s+(?=[A-Z"“])/);
  return s.filter((x) => /model|upc|sku|serial|lot|date code|item number|batch|printed|label|stamped|located on|found on/i.test(x)).slice(0, 3);
}

export interface Index {
  recalls: Recall[];
  idf: Map<string, number>;
  docs: Set<string>[];
  marks: Set<string>[];
}

/** Brand-ish words of a recall: the company's name and the first word of each product name, when rare. */
function marksOf(r: Recall, idf: Map<string, number>): Set<string> {
  // The recalling company's name counts even when it's common (Amazon, IKEA); a product name's first
  // word only when it's rare enough to be a brand ("Anker", not "Children's").
  const company = tokens(r.brand).filter((w) => (idf.get(w) ?? 0) > 3);
  const first = r.products.flatMap((p) => tokens(p).slice(0, 1)).filter((w) => (idf.get(w) ?? 0) > 4.5);
  return new Set([...company, ...first].filter((w) => !/^\d+$/.test(w)));
}

export function buildIndex(recalls: Recall[]): Index {
  const docs = recalls.map((r) => new Set(tokens([r.brand, ...r.products, ...r.types, r.title].join(" "))));
  const df = new Map<string, number>();
  for (const d of docs) for (const t of d) df.set(t, (df.get(t) ?? 0) + 1);
  const idf = new Map([...df].map(([t, n]) => [t, Math.log(recalls.length / n)]));
  return { recalls, idf, docs, marks: recalls.map((r) => marksOf(r, idf)) };
}

export interface Candidate { recall: Recall; score: number; brandWords: string[]; shared: string[] }

/** Recalls that share a brand word with the item and enough other words to be worth asking about. */
export function candidates(item: string, ix: Index, max = 3): Candidate[] {
  const words = tokens(item);
  const it = new Set(words);
  // Listings and order lines start with the brand: "Zinus 10 Inch … Memory Foam" is a Zinus, not a "Foam".
  const lead = new Set(words.slice(0, 3));
  const out: Candidate[] = [];
  ix.recalls.forEach((r, i) => {
    const brandWords = [...ix.marks[i]].filter((m) => lead.has(m));
    if (!brandWords.length) return;
    const shared = [...ix.docs[i]].filter((t) => it.has(t));
    // A shared brand word alone isn't enough ("Arctic" cooler vs "Arctic Eagle" drain snake):
    // the item must also share what kind of thing it is.
    const all = shared.reduce((s, t) => s + (ix.idf.get(t) ?? 0), 0);
    const kind = all - Math.max(...brandWords.map((t) => ix.idf.get(t) ?? 0)); // everything but the brand word itself
    if (kind < 2.5 && !idHits(item, r).length) return;
    const score = all;
    out.push({ recall: r, score, brandWords, shared });
  });
  return out.sort((a, b) => b.score - a.score).slice(0, max);
}

/** Identifiers from the notice that also appear, exactly, in what you own. */
export function idHits(item: string, r: Recall): string[] {
  const it = item.toUpperCase();
  return r.ids.filter((id) => id.length >= 4 && new RegExp(`(^|[^A-Z0-9])${id.replace(/[-/.]/g, "\\$&")}([^A-Z0-9]|$)`).test(it));
}

/** One record of the CPSC feed (saferproducts.gov), as far as we read it. */
export interface RawRecall {
  RecallNumber: string; RecallDate: string; Title: string; URL: string; Description: string;
  Products: { Name: string; Type: string }[];
  Retailers?: { Name: string }[]; Remedies?: { Name: string }[]; Images?: { URL: string }[];
}

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s);

/** The compact form the page ships and matches against. */
export function compact(r: RawRecall): Recall {
  const desc = (r.Description ?? "").replace(/\s+/g, " ").trim();
  const sold = (r.Retailers ?? []).map((x) => x.Name.replace(/\s+/g, " ").replace(/^Sold (Online )?(At|Exclusively At|Exclusively Online At)?:?\s*/i, "")).join("; ");
  return {
    n: r.RecallNumber,
    date: r.RecallDate.slice(0, 10),
    title: r.Title.replace(/\s+/g, " ").trim(),
    brand: brandFromTitle(r.Title),
    products: [...new Set((r.Products ?? []).map((p) => p.Name.replace(/\s+/g, " ").trim()).filter(Boolean))],
    types: [...new Set((r.Products ?? []).map((p) => (p.Type ?? "").trim()).filter(Boolean))],
    hazard: hazardFromTitle(r.Title),
    remedy: clip((r.Remedies?.[0]?.Name ?? "").replace(/\s+/g, " ").trim(), 400),
    sold: clip(sold, 200),
    ids: identifiers(desc),
    check: checkSentences(desc),
    desc: clip(desc, 600),
    url: r.URL,
    img: r.Images?.[0]?.URL ?? "",
  };
}
