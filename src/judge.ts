// The part Gemma plays: read one recall notice next to one thing you own and say whether the
// notice covers it. Gemma never decides alone: "recalled" needs the notice's own model number in
// what you own, and "not this one" needs a reason that's actually in the notice. Anything else
// becomes "check the label", with the notice's own words on what to look for.

import { idHits, tokens, type Candidate, type Recall } from "./recalls.ts";

export interface ChatMessage { role: "user" | "assistant"; content: string }
export type Generate = (messages: ChatMessage[], maxNewTokens: number) => Promise<string>;

export type Verdict =
  | { kind: "recalled"; recall: Recall; ids: string[] } // the notice's model number is in what you own
  | { kind: "check"; recall: Recall; why: string; look: string[] } // same product line, can't tell which unit
  | { kind: "not-this"; recall: Recall; why: string }; // same brand, the notice names something else

const MAX_NEW_TOKENS = 60;

export function notice(r: Recall): string {
  return [`Recall: ${r.title}`, `Products: ${r.products.join("; ")}`, `Notice: ${r.desc}`].join("\n");
}

function request(item: string, r: Recall): string {
  return [
    "Is the thing I own the same kind of product as the recalled one?",
    "",
    `I own: ${item}`,
    `Recalled: ${r.products.join("; ")}${r.types.length ? ` (${r.types.join(", ")})` : ""}`,
    "",
    "Answer SAME or DIFFERENT, then the kind of product the recall is about, in the recall's own words.",
  ].join("\n");
}

const ex = (products: string[], types: string[]): Recall => ({ n: "x", date: "", title: "", brand: "", products, types, hazard: "", remedy: "", sold: "", ids: [], check: [], desc: "", url: "", img: "" });
const EXAMPLES: [string, Recall, string][] = [
  ["Acme Cordless Hand Vacuum, 12V, Gray", ex(["Acme SteamPro Iron"], ["Irons"]), "DIFFERENT: Acme SteamPro Iron"],
  ["Acme Steam Iron for Clothes with Auto Shut-Off...", ex(["Acme SteamPro Iron"], ["Irons"]), "SAME: Acme SteamPro Iron"],
  ["Bloom Kids Bunk Bed, Twin over Twin, White", ex(["Bloom Children's Desk Lamps"], ["Lamps"]), "DIFFERENT: Bloom Children's Desk Lamps"],
];

export function judgeMessages(item: string, r: Recall): ChatMessage[] {
  return [
    ...EXAMPLES.flatMap(([i, rr, a]): ChatMessage[] => [
      { role: "user", content: request(i, rr) },
      { role: "assistant", content: a },
    ]),
    { role: "user", content: request(item, r) },
  ];
}

/** Every content word of the quote must be in the notice: a reason Gemma made up doesn't count. */
export function grounded(quote: string, r: Recall): boolean {
  const src = new Set(tokens(notice(r)));
  const words = tokens(quote);
  return words.length > 0 && words.every((w) => src.has(w));
}

export function parseAnswer(text: string): { label: "SAME" | "DIFFERENT" | "UNSURE"; quote: string } | undefined {
  const m = text.replace(/\*/g, "").match(/\b(SAME|DIFFERENT|UNSURE)\s*:\s*(.+)/i);
  if (!m) return undefined;
  return { label: m[1].toUpperCase() as "SAME" | "DIFFERENT" | "UNSURE", quote: m[2].trim().split("\n")[0].slice(0, 200) };
}

/** What to look for on yours: the notice's own sentences, or its identifiers when it has no such sentence. */
const lookFor = (r: Recall) => (r.check.length ? r.check : r.ids.length ? [`The notice lists: ${r.ids.slice(0, 8).join(", ")}`] : [r.desc.split(/(?<=\.)\s/)[0]]);

/** Model-ish words: anything with a digit in it ("737", "24k", "a1263"), sizes aside. */
export function designators(text: string): Set<string> {
  return new Set(tokens(text).filter((t) => /\d/.test(t) && !/^\d{1,2}$/.test(t) && !/^\d+(in|ft|oz|lb|qt|pc|pk|ct|mm|cm|v|w|mah)$/.test(t)));
}

export async function judge(item: string, c: Candidate, generate: Generate): Promise<Verdict> {
  const r = c.recall;
  const ids = idHits(item, r);
  if (ids.length) return { kind: "recalled", recall: r, ids };
  // Both sides name a model and the names don't meet: the notice is about a different model. No model needed.
  const mine = designators(item);
  const theirs = designators([...r.products, ...r.ids].join(" "));
  if (mine.size && theirs.size && ![...mine].some((d) => theirs.has(d)))
    return { kind: "not-this", recall: r, why: `The notice covers ${[...r.products].slice(0, 2).join("; ")}${r.ids.length ? ` (${r.ids.slice(0, 4).join(", ")})` : ""}; yours says ${[...mine].join(", ")}.` };
  // Otherwise Gemma decides one thing: is it even the same kind of product? A name cut short
  // ("Zinus Memory Foam 10 Inch...") doesn't say what it is, so "different" can't be trusted there.
  const cutShort = /(\.\.\.|…)$/.test(item.trim());
  const ans = cutShort ? undefined : parseAnswer(await generate(judgeMessages(item, r), MAX_NEW_TOKENS).catch(() => ""));
  if (ans?.label === "DIFFERENT" && !cutShort && grounded(ans.quote, r)) return { kind: "not-this", recall: r, why: `The notice is about ${ans.quote}.` };
  return { kind: "check", recall: r, why: ans?.label === "SAME" && grounded(ans.quote, r) ? ans.quote : (r.products[0] ?? r.title), look: lookFor(r) };
}
