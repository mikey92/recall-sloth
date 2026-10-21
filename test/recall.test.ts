import { describe, expect, test } from "vitest";
import { brandFromTitle, buildIndex, candidates, checkSentences, hazardFromTitle, identifiers, type Recall } from "../src/recalls.ts";
import { designators, grounded, judge, parseAnswer } from "../src/judge.ts";
import { extractItems } from "../src/extract.ts";

const R = (p: Partial<Recall>): Recall => ({
  n: "1", date: "2025-06-12", title: "", brand: "", products: [], types: [], hazard: "", remedy: "", sold: "", ids: [], check: [], desc: "", url: "", img: "", ...p,
});

const anker = R({
  n: "25338",
  title: "More than One Million Anker Power Banks Recalled Due to Fire and Burn Hazards",
  brand: "",
  products: ["Anker PowerCore 10000 power banks (model A1263 only)"],
  types: ["Batteries"],
  ids: ["A1263"],
  check: ['The model number "A1263" and serial number "SN" are printed on the bottom.'],
  desc: "This recall involves Anker PowerCore 10000 power banks with model number A1263.",
});
const foam = R({ n: "17194", title: "Quality Foam Recalls Mattresses", brand: "Quality Foam", products: ["Quality Foam mattresses"], types: ["Mattresses"] });
const warmers = R({ n: "27011", title: "Kobayashi Recalls Rechargeable Hand Warmers", brand: "Kobayashi", products: ["HotHands Rechargeable Hand Warmers"], types: ["Hand Warmers"], desc: "This recall involves HotHands rechargeable hand warmers, model H163650." });
// Filler so the brand words are rare, as they are among 3,000 real notices.
const filler = Array.from({ length: 400 }, (_, i) => R({ n: `f${i}`, title: `Brand${i} Recalls Lamp${i % 7} Due to Fire Hazard`, brand: `Brand${i}`, products: [`Brand${i} desk lamp ${i}`], types: ["Lamps"] }));
const ix = buildIndex([anker, foam, warmers, ...filler]);
const never = async () => {
  throw new Error("the model should not be asked");
};

describe("reading notices", () => {
  test("brand, hazard and identifiers come from the notice", () => {
    expect(brandFromTitle("3M Company Recalls Scotch™ Thermal Laminators Due to Risk of Fire")).toBe("3M Company");
    expect(hazardFromTitle("3M Company Recalls Scotch™ Thermal Laminators Due to Risk of Fire")).toBe("Risk of Fire");
    expect(identifiers('Model TL1302 and TL1302VP, UPC 021200123456, in 2019. It is 17.15 inches. The 6-drawer and 3-in-1 units.')).toEqual(["TL1302", "TL1302VP", "021200123456"]);
    expect(checkSentences("It is blue. The model number is printed on the bottom. Stop using it.")).toEqual(["The model number is printed on the bottom."]);
  });
});

describe("finding candidates", () => {
  test("the brand has to lead the item name", () => {
    expect(candidates("Anker PowerCore 10000 Portable Charger", ix).map((c) => c.recall.n)).toEqual(["25338"]);
    expect(candidates("Zinus 10 Inch Green Tea Memory Foam Mattress", ix)).toEqual([]); // "foam" is not a brand here
  });
  test("a brand word alone isn't enough: the kind of product has to meet too", () => {
    expect(candidates("Anker USB C Wall Charger 65W", ix)).toEqual([]);
  });
});

describe("deciding", () => {
  test("the notice's model number in your item means recalled, no model asked", async () => {
    const [c] = candidates("Anker PowerCore 10000 A1263 power bank", ix);
    expect((await judge("Anker PowerCore 10000 A1263 power bank", c, never)).kind).toBe("recalled");
  });
  test("two different model names: not this one, no model asked", async () => {
    const [c] = candidates("Anker 737 Power Bank (PowerCore 24K)", ix);
    const v = await judge("Anker 737 Power Bank (PowerCore 24K)", c, never);
    expect(v.kind).toBe("not-this");
    expect(designators("Anker 737 Power Bank (PowerCore 24K)")).toEqual(new Set(["737", "24k"]));
  });
  test("a name cut short can only ever be 'check the label'", async () => {
    const [c] = candidates("HotHands Rechargeable Hand...", ix);
    expect((await judge("HotHands Rechargeable Hand...", c, never)).kind).toBe("check");
  });
  test("Gemma's 'different' counts only when it quotes the notice", async () => {
    const [c] = candidates("HotHands Body & Hand Super Warmers, 40 count", ix);
    expect((await judge("HotHands Body & Hand Super Warmers, 40 count", c, async () => "DIFFERENT: HotHands Rechargeable Hand Warmers")).kind).toBe("not-this");
    expect((await judge("HotHands Body & Hand Super Warmers, 40 count", c, async () => "DIFFERENT: disposable heat packs")).kind).toBe("check");
    expect((await judge("HotHands Body & Hand Super Warmers, 40 count", c, async () => "I think so")).kind).toBe("check");
  });
  test("answers are parsed loosely, quotes checked strictly", () => {
    expect(parseAnswer("**DIFFERENT**: Acme irons\nbecause…")).toEqual({ label: "DIFFERENT", quote: "Acme irons" });
    expect(grounded("Anker PowerCore 10000 power banks", anker)).toBe(true);
    expect(grounded("Anker wireless earbuds", anker)).toBe(false);
  });
});

describe("what you paste", () => {
  test("order emails: the quoted titles", () => {
    expect(extractItems('Thank you. You ordered "Zinus Memory Foam 10 Inch..." and 1 other item. Order #102-2114481-7583418')).toEqual(["Zinus Memory Foam 10 Inch..."]);
  });
  test("an orders page: product lines, not the noise around them", () => {
    const page = "Order placed\nOctober 3, 2026\nTotal\n$34.99\nAnker PowerCore 10000 Portable Charger\nBuy it again\nView your item\nIKEA MALM 6-drawer dresser\nReturn or replace items";
    expect(extractItems(page)).toEqual(["Anker PowerCore 10000 Portable Charger", "IKEA MALM 6-drawer dresser"]);
  });
});
