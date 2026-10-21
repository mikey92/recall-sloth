// What did you buy? Whatever you paste: a list, your Amazon "Your Orders" page, order emails.
// Plain text rules, no model: product names are lines (or quoted titles), everything around them is noise.

const NOISE = [
  /^(order placed|order #|order total|total|subtotal|grand total|ship to|sold by|delivered|arriving|arrived|shipped|out for delivery|return|returns|buy it again|track package|view your item|view order|write a (product )?review|leave seller feedback|get product support|archive order|invoice|problem with order|your orders?|hello|thank you|we hope|details|qty|quantity|price|tax|estimated|payment|visa|mastercard|gift|amazon|prime|recommended|customers who|page \d)/i,
  /^\$?\d[\d,.]*\s*(usd)?$/i, // prices and numbers
  /^\d{1,2}\/\d{1,2}\/\d{2,4}$/, // dates
  /^(january|february|march|april|may|june|july|august|september|october|november|december) \d/i,
  /^(mon|tue|wed|thu|fri|sat|sun)[a-z]*,? /i,
  /^[\d-]{10,}$/, // order numbers
  /@/,
];

export function extractItems(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (s: string) => {
    const t = s.replace(/\s+/g, " ").replace(/^[-•*·\d.)\s]+(?=[A-Za-z])/, "").trim();
    const k = t.toLowerCase();
    if (t.length < 5 || t.length > 300 || seen.has(k)) return;
    if (!/[a-z]{3}/i.test(t) || t.split(" ").length < 2) return;
    if (NOISE.some((r) => r.test(t))) return;
    seen.add(k);
    out.push(t);
  };
  // Order emails: You ordered "Anker PowerCore 10000…" and 1 other item.
  const quoted = [...text.matchAll(/(?:ordered|order of)\s*:?\s*["“]([^"”]{4,250})["”]/gi)].map((m) => m[1]);
  if (quoted.length) quoted.forEach(add);
  else text.split(/\r?\n/).forEach(add);
  return out;
}
