# Evaluation

Everything here is reproducible: `node eval/build-set.ts`, then `node eval/run.ts` (add `--none` or `--ollama <model>`). Results with every row are in `eval/results/`.

## The set: real product names only

353 cases built from the CPSC feed itself (`eval/set.json`), nothing invented:

| Kind | Cases | What it is | Right answer |
|---|---|---|---|
| positive | 150 | A product sold on Amazon and recalled, named the way the maker names it ("INIU BI-B41 Power Banks") | recalled or check the label |
| positive, cut short | 108 | The same names cut at about 28 characters, the way Amazon's order emails cut them ("VIVO MOUNT-PLAY5 speaker...") | recalled or check the label |
| same-brand negative | 95 | Another recalled product of the **same brand**, of a different kind, checked against this recall (STIHL hedge trimmers vs the STIHL chain saw recall) | not this one, or no candidate at all |

Same brand is the hard case on purpose: a different brand never gets past the first step.

Two errors matter, and not equally:
- **Wrongly dismissed**: a recalled product called "not this one". This is the dangerous one.
- **False alarm**: a same-brand product that isn't covered still says "check the label". Annoying, and costs a look at a label.

## Results

| Who decides the close calls | Recalled products caught | Wrongly dismissed | False alarms (same brand) | Model calls |
|---|---|---|---|---|
| Rules only, no model | 246 / 258 (95%) | 0 | 16 / 95 (17%) | 0 |
| Gemma 3 1B (Transformers.js) | 246 / 258 (95%) | 0 | 16 / 95 (17%) | 148 |
| **Gemma 4 E2B (Transformers.js, what the page runs)** | **246 / 258 (95%)** | **0** | **5 / 95 (5%)** | 148 |
| Gemma 4 E2B (Ollama, Q4) | 246 / 258 (95%) | 0 | 7 / 95 (7%) | 148 |
| Gemma 4 E4B (Ollama) | 246 / 258 (95%) | 0 | 8 / 95 (8%) | 148 |

Gemma 3 1B answered SAME to nearly everything: it changed nothing. Gemma 4 E2B took false alarms from 16 to 5 without dismissing a single recalled product, and the bigger E4B was no better, so the page ships E2B.

The 12 recalled products never caught are retrieval misses, not model errors: names cut short before the brand ("DeWALT, Stanley and..."), or notices whose title names no brand ("Dehumidifiers").

## What getting here took

- **First version, no guard on cut names: 60 recalled products wrongly dismissed.** Gemma 4 E2B, shown "Zinus Memory Foam 10 Inch..." and a recall, often said DIFFERENT: the cut name doesn't say what it is. Now a name ending in "..." never reaches the model; it can only be "check the label". Dismissals went to 0.
- **"6-drawer" is not a model number.** The first identifier filter called IKEA's "6-drawer" and "3-drawer" model numbers and marked every IKEA dresser "recalled". Number-word pairs ("6-drawer", "3-in-1") are now excluded.
- **A brand word in the wrong place.** "Zinus … Memory Foam Mattress" matched a recall by the company Quality Foam. The brand now has to be among the item's first three words, the way listings and order lines start.
- **One bad label in my own set.** The first build paired two Samsung Galaxy Note7 recalls as a "negative"; they're the same phone. Pairs that share a model designator are now excluded from negatives.

## Reading every dismissal

I read all 13 cases where Gemma 4 E2B or the model-name rule said "not this one" on a negative, next to the notice. All 13 are right, for example:

- STIHL battery-powered hedge trimmers → "The notice is about gas-powered chain saws."
- Rollerblade inline skating helmets → "The notice is about Rollerblade Fury Inline Skates and Rollerblade Fury brake supports."
- Polaris Ranger 900 → the rule: the notice covers Ranger 500, 570 and EV.

The 5 false alarms left are mostly the same kind of product, a different model with no model number to compare (Britax B-Ready vs B-Agile strollers; two Rocky Mountain bicycle recalls). "Check the label" is the right call there.

One quirk: "Kids2" counts as an identifier because it mixes letters and digits, so "All models of Kids2 Rocking Sleepers" is marked recalled by model number. That notice covers all models, so the answer is right for the wrong reason.

## My own orders

I ran it on my own Amazon order emails (56 since 2014; read in my Gmail and kept on my machine, mode 600).

- Amazon names only a category in 20 of them ("Ordered 1 item: Electronics"), and cuts 23 of the 24 names it does give.
- Of 24 named items, 22 had no recall sharing their brand and kind.
- One "not this one": a comforter vs. a robe recall.
- One "check the label": "HotHands Body & Hand Super..." vs. Kobayashi's recall of **rechargeable** HotHands hand warmers, model H163650. Mine were the disposable kind; the notice's own "how to tell" sentence settles it in seconds. The tool can't, because Amazon cut the name before the word that matters.

Nothing I own is recalled. That's the expected answer, and it took about ten seconds instead of an afternoon of searching cpsc.gov.
