// Turns the CPSC recall feed (saferproducts.gov, public domain) into the compact list the page ships.
//   curl "https://www.saferproducts.gov/RestWebServices/Recall?format=json&RecallDateStart=2016-01-01" -o data/cpsc-raw.json
//   node scripts/build-recalls.ts
import { readFileSync, writeFileSync } from "node:fs";
import { compact, type Recall, type RawRecall } from "../src/recalls.ts";

const raw = JSON.parse(readFileSync("data/cpsc-raw.json", "utf8")) as RawRecall[];
const recalls: Recall[] = raw.filter((r) => r.Title && r.Products?.length).map(compact).sort((a, b) => b.date.localeCompare(a.date));
writeFileSync("public/recalls.json", JSON.stringify(recalls));
const amazon = recalls.filter((r) => /amazon/i.test(r.sold)).length;
console.log(`${recalls.length} recalls (${recalls.at(-1)?.date} to ${recalls[0]?.date}), ${amazon} sold on Amazon, ${recalls.filter((r) => r.ids.length).length} with identifiers; ${Math.round(JSON.stringify(recalls).length / 1024)} KB`);
