// The shopping engine against the real Brave and the real shops, from this Mac (not deployed; never imported by index.ts).
//   deno run --allow-net --allow-read --allow-write --allow-env shop_probe.ts record   saves Brave's answers for the acceptance
//     questions to fixtures/brave/, trimmed to what shop.ts reads, for shop_live_test.ts
//   deno run --allow-net --allow-read --allow-env shop_probe.ts run [n]                   runs the whole engine live and prints what it found
//   deno run --allow-net --allow-read --allow-write --allow-env shop_probe.ts deployed [n] the same through the deployed /shop (Supabase's
//     network, which is what the phone gets), signed in anonymously as the app is; saves each answer to fixtures/shop/
// Brave's key from the shell's BRAVE_API_KEY or the repo root's git-ignored .env.local, never the repo (not needed for `deployed`).
import {braveUrl, runShop, type ShopAsk} from "./shop.ts";

/** What Claude would likely send for each acceptance question (iPhone 17, Samsung 65" QLED, wireless headphones, gaming PC, MacBook). */
export const ACCEPTANCE: {slug: string; ask: ShopAsk}[] = [
  {slug: "iphone-17", ask: {queries: ["iPhone 17 256GB price UK", "Apple iPhone 17 buy UK", "iPhone 17 Argos", "iPhone 17 John Lewis"], match: ["iPhone 17"], exclude: [], maxPrice: 0}},
  {slug: "samsung-65-qled", ask: {queries: ["Samsung 65 inch QLED TV price UK", "Samsung QLED 65 inch Argos", "Samsung QLED 65 inch John Lewis", "Samsung Q7F 65 inch QLED", "Samsung 65 QLED TV Currys"], match: ["Samsung", "65", "QLED"], exclude: [], maxPrice: 0}},
  {slug: "wireless-headphones", ask: {queries: ["best wireless headphones UK", "Sony WH-1000XM6 price UK", "Bose QuietComfort Ultra headphones price UK", "noise cancelling headphones under £100 UK", "wireless headphones Argos", "wireless headphones John Lewis"], match: ["headphones"], exclude: ["earbuds"], maxPrice: 0}},
  {slug: "gaming-pc", ask: {queries: ["gaming PC RTX 5060 Ti UK", "prebuilt gaming PC Scan", "gaming PC Argos", "gaming PC Currys", "PCSpecialist gaming PC", "gaming PC under £1000 UK"], match: ["gaming PC"], exclude: [], maxPrice: 0}},
  {slug: "macbook", ask: {queries: ["MacBook Air 13 inch price UK", "MacBook Air Argos", "MacBook Air John Lewis", "MacBook Air Currys", "MacBook Air buy UK"], match: ["MacBook Air"], exclude: [], maxPrice: 0}},
];

async function key(): Promise<string> {
  const env = Deno.env.get("BRAVE_API_KEY");
  if (env) return env;
  const file = await Deno.readTextFile(new URL("../../../.env.local", import.meta.url)).catch(() => "");
  return /^BRAVE_API_KEY=(.*)$/m.exec(file)?.[1].trim().replace(/^["']|["']$/g, "") ?? "";
}

// only what shop.ts reads, so a fixture is small and holds nothing else of Brave's
const KEEP = ["title", "url", "description", "extra_snippets", "thumbnail", "profile", "page_age", "page_fetched", "age", "product", "product_cluster", "schemas"];
const trim = (got: {web?: {results?: Record<string, unknown>[]}}) => ({web: {results: (got.web?.results ?? []).map(r => Object.fromEntries(KEEP.filter(k => k in r).map(k => [k, r[k]])))}});

// the app's project and publishable key (not secrets: mobile/src/services/session.ts)
const SUPABASE = "https://sgchailpcwkffckwnazp.supabase.co", PUBLIC_KEY = "sb_publishable_OE0qTJsSKO5BGmfh94lToA_ot0xrFGj";
const print = (slug: string, r: {products?: {confidence: string | null; from?: true; price: number | null; retailer: string; name: string; condition: string; inStock?: false; image: string | null; url: string}[]; partial?: string; stats?: unknown; error?: string}, ms?: number) => {
  console.log(`\n=== ${slug}${ms ? ` (${(ms / 1000).toFixed(1)}s round trip)` : ""}`);
  if (r.error || !r.products) { console.log("ERROR", r.error, JSON.stringify(r.stats ?? {})); return; }
  for (const p of r.products) console.log(`  ${p.confidence ?? "no price"}: ${p.from ? "from " : ""}${p.price ?? "-"} ${p.retailer} · ${p.name} · ${p.condition}${p.inStock === false ? " · out of stock" : ""} · photo ${p.image ? "yes" : "no"} · ${p.url}`);
  console.log(`  ${r.partial ?? "five or more"}; stats ${JSON.stringify(r.stats)}`);
};

if (import.meta.main) {
  const [mode = "run", only] = Deno.args;
  const picked = only ? ACCEPTANCE.filter(a => a.slug.includes(only)) : ACCEPTANCE;
  if (mode === "deployed") {
    const s = await fetch(`${SUPABASE}/auth/v1/signup`, {method: "POST", headers: {apikey: PUBLIC_KEY, "content-type": "application/json"}, body: "{}"}).then(r => r.json());
    if (!s.access_token) { console.error("Couldn't sign in", s); Deno.exit(1); }
    await Deno.mkdir(new URL("./fixtures/shop/", import.meta.url), {recursive: true});
    for (const {slug, ask} of picked) {
      const started = Date.now();
      const r = await fetch(`${SUPABASE}/functions/v1/accountant/shop`, {method: "POST", headers: {authorization: `Bearer ${s.access_token}`, apikey: PUBLIC_KEY, "content-type": "application/json"},
        body: JSON.stringify({queries: ask.queries, match: ask.match, exclude: ask.exclude, max_price: ask.maxPrice})});
      const body = await r.json().catch(() => ({error: `status ${r.status}`}));
      print(slug, body, Date.now() - started);
      await Deno.writeTextFile(new URL(`./fixtures/shop/${slug}.json`, import.meta.url), JSON.stringify({recorded: new Date().toISOString(), ask, status: r.status, body}, null, 1));
    }
    Deno.exit(0);
  }
  const k = await key();
  if (!k) { console.error("No BRAVE_API_KEY in the shell or .env.local"); Deno.exit(1); }
  if (mode === "record") {
    await Deno.mkdir(new URL("./fixtures/brave/", import.meta.url), {recursive: true});
    for (const {slug, ask} of picked) {
      const pages = [];
      for (const q of ask.queries) {
        const r = await fetch(braveUrl(q), {headers: {"X-Subscription-Token": k, accept: "application/json"}});
        const body = r.ok ? trim(await r.json()) : {web: {results: []}};
        console.log(`${slug}: ${q} → ${r.status}, ${body.web.results.length} results, ${body.web.results.filter(x => "product" in x || "product_cluster" in x).length} with products, ${body.web.results.filter(x => "schemas" in x).length} with schemas; limit ${r.headers.get("x-ratelimit-limit")}`);
        pages.push({q, body});
        await new Promise(res => setTimeout(res, 1100)); // gentle on the rate limit
      }
      await Deno.writeTextFile(new URL(`./fixtures/brave/${slug}.json`, import.meta.url), JSON.stringify({recorded: new Date().toISOString(), ask, pages}, null, 1));
    }
  } else {
    for (const {slug, ask} of picked) print(slug, await runShop(ask, {fetch, key: k}));
  }
}
