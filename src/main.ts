// The page: take whatever you paste, find the recalls that could be about it, let Gemma read the
// close calls, and sort everything into recalled / check the label / not this one / nothing on file.

import { buildIndex, candidates, compact, type Index, type RawRecall, type Recall } from "./recalls.ts";
import { judge, type ChatMessage, type Generate, type Verdict } from "./judge.ts";
import { extractItems } from "./extract.ts";
import { MODELS, type ModelKey } from "./llm.ts";
import type { Device, Dtype, FromWorker, ToWorker } from "./worker.ts";
import "./styles.css";

const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;
const itemsBox = $<HTMLTextAreaElement>("#items");
const checkButton = $<HTMLButtonElement>("#check");
const status = $<HTMLParagraphElement>("#status");
const bar = $<HTMLProgressElement>("#bar");
const results = $<HTMLDivElement>("#results");
const source = $<HTMLParagraphElement>("#source");

const EXAMPLE = [
  "Anker PowerCore 10000 Portable Charger, 10000mAh Power Bank",
  "Anker 737 Power Bank (PowerCore 24K) 140W",
  "IKEA MALM 6-drawer dresser, white",
  "HotHands Body & Hand Super Warmers, 40 count",
  "Fisher-Price Rock 'n Play Sleeper",
  "Zinus 10 Inch Green Tea Memory Foam Mattress, Queen",
  "SONGMICS Cube Storage Organizer, 9 Cubes",
  "Scotch Thermal Laminator...",
  "Instant Pot Duo 7-in-1 Electric Pressure Cooker, 6 Quart",
  "Ninja Professional Plus Blender",
].join("\n");

const first = (s: string, n = 240) => {
  const m = s.match(/^.{20,}?[.!?](?=\s|$)/);
  const t = m && m[0].length <= n ? m[0] : s.slice(0, n).replace(/\s+\S*$/, "") + "…";
  return t;
};
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

// ---------- the recall list: shipped with the page, topped up live from CPSC ----------

let index: Index | null = null;
async function recalls(): Promise<Index> {
  if (index) return index;
  const shipped = (await (await fetch("/recalls.json")).json()) as Recall[];
  let fresh: Recall[] = [];
  try {
    // Anything CPSC has published since this page was built. saferproducts.gov allows browsers to ask.
    const since = shipped[0]?.date ?? "2026-01-01";
    const r = await fetch(`https://www.saferproducts.gov/RestWebServices/Recall?format=json&RecallDateStart=${since}`);
    const known = new Set(shipped.map((x) => x.n));
    fresh = ((await r.json()) as RawRecall[]).filter((x) => x.Title && x.Products?.length && !known.has(x.RecallNumber)).map(compact);
  } catch {
    /* offline or CPSC down: the shipped list still works */
  }
  const all = [...fresh, ...shipped];
  source.textContent = `${all.length.toLocaleString()} recalls from the U.S. Consumer Product Safety Commission, ${all.at(-1)?.date.slice(0, 4)} to ${all[0]?.date}${fresh.length ? ` (${fresh.length} fetched live just now)` : ""}.`;
  index = buildIndex(all);
  return index;
}
recalls();

// ---------- Gemma, in a worker ----------

async function pickDevice(): Promise<{ device: Device; dtype: Dtype }> {
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<{ features: Set<string> } | null> } }).gpu;
  if (gpu) {
    try {
      const adapter = await gpu.requestAdapter();
      if (adapter) return { device: "webgpu", dtype: adapter.features.has("shader-f16") ? "q4f16" : "q4" };
    } catch {
      /* fall through */
    }
  }
  return { device: "wasm", dtype: "q4" };
}

let worker: Worker | null = null;
let loadedKey = "";
let nextId = 0;
const waiting = new Map<number, { resolve: (t: string) => void; reject: (e: Error) => void }>();
let onLoad: { resolve: (s: number) => void; reject: (e: Error) => void } | null = null;
let onProgress: ((l: number, t: number) => void) | null = null;

function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
  worker.onmessage = (e: MessageEvent<FromWorker>) => {
    const m = e.data;
    if (m.type === "progress") onProgress?.(m.loaded, m.total);
    else if (m.type === "ready") onLoad?.resolve(m.seconds);
    else if (m.type === "generated") (waiting.get(m.id)?.resolve(m.text), waiting.delete(m.id));
    else if (m.type === "error") {
      const err = new Error(m.message);
      if (m.id != null) (waiting.get(m.id)?.reject(err), waiting.delete(m.id));
      else onLoad?.reject(err);
    }
  };
  return worker;
}
const send = (m: ToWorker) => getWorker().postMessage(m);

async function loadModel(model: ModelKey): Promise<Device> {
  const { device, dtype } = await pickDevice();
  const key = `${model}/${device}/${dtype}`;
  if (loadedKey === key) return device;
  onProgress = (l, t) => {
    bar.hidden = false;
    bar.max = t;
    bar.value = l;
    say(`Downloading ${MODELS[model].label} once (${Math.round(l / 1e6)} of ${Math.round(t / 1e6)} MB). After this it lives in your browser.`);
  };
  await new Promise<number>((resolve, reject) => {
    onLoad = { resolve, reject };
    send({ type: "load", model, device, dtype });
  });
  loadedKey = key;
  return device;
}

const gemma: Generate = (messages: ChatMessage[], maxNewTokens: number) =>
  new Promise((resolve, reject) => {
    const id = ++nextId;
    waiting.set(id, { resolve, reject });
    send({ type: "generate", id, messages, maxNewTokens });
  });

// ---------- the run ----------

function say(t: string) {
  status.textContent = t;
}

type Row = { item: string; verdicts: Verdict[] };

async function run() {
  const items = extractItems(itemsBox.value);
  if (!items.length) return say("Paste a few things you own first, one per line.");
  checkButton.disabled = true;
  results.innerHTML = "";
  try {
    say("Reading the recall list…");
    const ix = await recalls();
    const withCandidates = items.map((item) => ({ item, cands: candidates(item, ix, 3) }));
    const needModel = withCandidates.some((x) => x.cands.length);
    const choice = (document.querySelector('input[name="model"]:checked') as HTMLInputElement).value;
    let generate: Generate = async () => "";
    let who = "Rules only";
    if (needModel && choice !== "none") {
      const device = await loadModel(choice as ModelKey);
      generate = gemma;
      who = `${MODELS[choice as ModelKey].label} on your ${device === "webgpu" ? "GPU" : "CPU"}`;
    }
    bar.hidden = false;
    const total = withCandidates.reduce((n, x) => n + x.cands.length, 0);
    bar.max = Math.max(1, total);
    let done = 0;
    const rows: Row[] = [];
    const t0 = performance.now();
    for (const { item, cands } of withCandidates) {
      const verdicts: Verdict[] = [];
      for (const c of cands) {
        say(`${who}: reading recall notice ${++done} of ${total}, slowly…`);
        bar.value = done;
        verdicts.push(await judge(item, c, generate));
      }
      rows.push({ item, verdicts });
    }
    bar.hidden = true;
    const secs = Math.round((performance.now() - t0) / 100) / 10;
    say(`Checked ${items.length} things against ${ix.recalls.length.toLocaleString()} recalls in ${secs} s. ${who}. Nothing left this page.`);
    render(rows);
  } catch (e) {
    say(`Something went wrong: ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    checkButton.disabled = false;
  }
}

function notice(r: Recall, extra = "") {
  return `<div class="notice">
    ${r.img ? `<img src="${esc(r.img)}" alt="" referrerpolicy="no-referrer" />` : ""}
    <div>
      <a href="${esc(r.url)}" target="_blank" rel="noreferrer">${esc(r.title)}</a>
      <small>CPSC recall ${esc(r.n)} · ${esc(r.date)}${r.sold ? ` · sold at ${esc(r.sold.slice(0, 90))}` : ""}</small>
      ${extra}
    </div>
  </div>`;
}

function render(rows: Row[]) {
  const best = (vs: Verdict[]) => vs.find((v) => v.kind === "recalled") ?? vs.find((v) => v.kind === "check");
  const recalled = rows.filter((r) => r.verdicts.some((v) => v.kind === "recalled"));
  const check = rows.filter((r) => !recalled.includes(r) && r.verdicts.some((v) => v.kind === "check"));
  const notThis = rows.filter((r) => r.verdicts.length && !recalled.includes(r) && !check.includes(r));
  const nothing = rows.filter((r) => !r.verdicts.length);
  const section = (cls: string, title: string, list: Row[], body: (r: Row) => string) =>
    list.length ? `<section class="group ${cls}"><h2>${title} <span>${list.length}</span></h2>${list.map(body).join("")}</section>` : "";
  results.innerHTML =
    section("bad", "Recalled", recalled, (r) => {
      const v = best(r.verdicts) as Extract<Verdict, { kind: "recalled" }>;
      return `<article><h3>${esc(r.item)}</h3><p class="why">The notice's model number <b>${esc(v.ids.join(", "))}</b> is in what you pasted.</p>${notice(v.recall, `<p class="remedy"><b>What to do:</b> ${esc(first(v.recall.remedy))}</p>`)}</article>`;
    }) +
    section("warn", "Check the label", check, (r) => {
      const vs = r.verdicts.filter((v): v is Extract<Verdict, { kind: "check" }> => v.kind === "check");
      return `<article><h3>${esc(r.item)}</h3>${vs
        .map(
          (v) =>
            notice(
              v.recall,
              `<p class="look"><b>How to tell:</b> ${esc(first(v.look.join(" "), 260))}</p><p class="remedy"><b>If yours is affected:</b> ${esc(first(v.recall.remedy))}</p>`,
            ),
        )
        .join("")}</article>`;
    }) +
    section("ok", "Not this one", notThis, (r) => {
      const vs = r.verdicts.filter((v): v is Extract<Verdict, { kind: "not-this" }> => v.kind === "not-this");
      return `<article><h3>${esc(r.item)}</h3>${vs.map((v) => `<p class="why">${esc(v.why)} <a href="${esc(v.recall.url)}" target="_blank" rel="noreferrer">Notice ${esc(v.recall.n)}</a></p>`).join("")}</article>`;
    }) +
    section("none", "No recall on file", nothing, (r) => `<p class="plain-item">${esc(r.item)}</p>`);
}

checkButton.addEventListener("click", run);
$<HTMLButtonElement>("#example").addEventListener("click", () => {
  itemsBox.value = EXAMPLE;
  run();
});
