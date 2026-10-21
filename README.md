# 🦥 Recall Sloth

**Nobody reads recall notices. Paste what you've bought; Gemma, running in your browser, checks it against every U.S. consumer product recall since 2016.**

Live: https://recall-sloth.mikey9220.workers.dev · Evaluation: [eval/EVAL.md](eval/EVAL.md)

Paste a list, your Amazon "Your Orders" page, or order emails as they are. Every item comes back in one of four piles:

| Pile | When |
|---|---|
| **Recalled** | the notice's own model number is in what you pasted |
| **Check the label** | same brand, same kind of product, and nothing rules it out; you get the notice's own sentence on where to look ("The model number A1263 is printed on the bottom") and what to do |
| **Not this one** | same brand, but the notice is about a different model ("PowerCore 10000 (A1263); yours says 737") or a different kind of product |
| **No recall on file** | no recall shares its brand and its kind of product |

What you paste never leaves the page. The recall list ships with the site (3,411 notices from the [CPSC](https://www.saferproducts.gov/RestWebServices)), and the page asks CPSC directly for anything published since.

## How it decides

```
your text → item names (plain rules: lines, or quoted titles in order emails)
→ candidates: recalls whose brand is among the item's first three words AND that share what kind of thing it is
→ model number from the notice in your item?            → Recalled
→ both name a model, and the names don't meet?          → Not this one
→ name cut short ("Zinus Memory Foam 10 Inch...")?       → Check the label
→ Gemma 4 E2B: same kind of product? DIFFERENT, quoting the notice → Not this one
                                      anything else      → Check the label
```

Gemma only answers one question, and only where the rules can't: is this the same kind of product as the one recalled? Its "different" counts only when every word it quotes is in the notice, and never for a name that was cut short. The safe direction is always "check the label".

## Run it

```bash
npm install
npm run dev            # the page
npm test               # unit tests
npm run recalls        # rebuild public/recalls.json from data/cpsc-raw.json (see scripts/build-recalls.ts)
node eval/build-set.ts # the evaluation set, from CPSC product names only
node eval/run.ts       # Gemma 4 E2B through Transformers.js in Node, as the page runs it
node eval/run.ts --none            # rules only
node eval/run.ts --ollama gemma4:e4b
```

Gemma runs in a Web Worker through Transformers.js and ONNX Runtime Web: WebGPU when the browser has it, otherwise "rules only" is the honest fallback. Static files on Cloudflare's free tier; no server code.

## License

MIT. Recall data: U.S. Consumer Product Safety Commission (public domain).
