import {classifyOf, classifyParams, CLASSIFY_MODEL, MAX_CATS, MAX_PAYEES, readClassify, type ClassifyAsk} from "./classify.ts";

const eq = (a: unknown, b: unknown) => {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${JSON.stringify(a)} !== ${JSON.stringify(b)}`);
};

const CATS = [{id: "groceries", name: "Groceries"}, {id: "eating", name: "Eating out"}, {id: "other", name: "General"}];
const ask = (body: unknown) => readClassify(JSON.stringify(body));

// --- readClassify -----------------------------------------------------------

Deno.test("valid request with payees and categories is accepted", () => {
  eq(ask({payees: ["tesco"], categories: CATS}), {payees: ["tesco"], categories: CATS});
});

Deno.test("empty payees array is rejected", () => {
  eq(ask({payees: [], categories: CATS}), {error: "bad_request"});
});

Deno.test("payees over MAX_PAYEES are rejected", () => {
  const many = Array(MAX_PAYEES + 1).fill("shop");
  eq(ask({payees: many, categories: CATS}), {error: "bad_request"});
});

Deno.test("non-string payee is rejected", () => {
  eq(ask({payees: [123], categories: CATS}), {error: "bad_request"});
});

Deno.test("empty string payee is rejected", () => {
  eq(ask({payees: [""], categories: CATS}), {error: "bad_request"});
});

Deno.test("payee over max length is rejected", () => {
  eq(ask({payees: ["x".repeat(201)], categories: CATS}), {error: "bad_request"});
});

Deno.test("empty categories array is rejected", () => {
  eq(ask({payees: ["tesco"], categories: []}), {error: "bad_request"});
});

Deno.test("categories over MAX_CATS are rejected", () => {
  const many = Array(MAX_CATS + 1).fill({id: "x", name: "X"});
  eq(ask({payees: ["tesco"], categories: many}), {error: "bad_request"});
});

Deno.test("category missing id is rejected", () => {
  eq(ask({payees: ["tesco"], categories: [{name: "Groceries"}]}), {error: "bad_request"});
});

Deno.test("category missing name is rejected", () => {
  eq(ask({payees: ["tesco"], categories: [{id: "groceries"}]}), {error: "bad_request"});
});

Deno.test("non-JSON body is rejected", () => {
  eq(readClassify("not json"), {error: "bad_request"});
});

Deno.test("missing payees field is rejected", () => {
  eq(ask({categories: CATS}), {error: "bad_request"});
});

Deno.test("missing categories field is rejected", () => {
  eq(ask({payees: ["tesco"]}), {error: "bad_request"});
});

// --- classifyParams ---------------------------------------------------------

Deno.test("classifyParams uses Haiku and no betas or tools", () => {
  const p = classifyParams({payees: ["tesco"], categories: CATS});
  eq(p.model, CLASSIFY_MODEL);
  eq((p as {betas?: unknown}).betas, undefined);
  eq((p as {tools?: unknown}).tools, undefined);
  if (typeof p.max_tokens !== "number" || p.max_tokens < 100) throw new Error("max_tokens too small");
  if (!Array.isArray(p.messages) || p.messages.length !== 1) throw new Error("expected one user message");
});

Deno.test("classifyParams encodes payees as JSON in the user message", () => {
  const p = classifyParams({payees: ["tesco", "nandos"], categories: CATS});
  const msg = p.messages[0] as {role: string; content: string};
  eq(msg.role, "user");
  eq(JSON.parse(msg.content), ["tesco", "nandos"]);
});

Deno.test("classifyParams includes all category ids in the system prompt", () => {
  const p = classifyParams({payees: ["tesco"], categories: CATS});
  const sys = typeof p.system === "string" ? p.system : (p.system as {text: string}[])[0].text;
  if (!sys.includes("groceries: Groceries")) throw new Error("missing category groceries");
  if (!sys.includes("eating: Eating out")) throw new Error("missing category eating");
});

// --- classifyOf -------------------------------------------------------------

const A: ClassifyAsk = {payees: ["tesco express", "nandos", "unknown merchant"], categories: CATS};

function content(text: string) {
  return [{type: "text" as const, text}];
}

Deno.test("valid array response maps each payee to cat+confidence", () => {
  const json = JSON.stringify([
    {payee: "tesco express", cat: "groceries", confidence: "high"},
    {payee: "nandos", cat: "eating", confidence: "high"},
  ]);
  const r = classifyOf(content(json), A);
  eq(r.length, 2);
  eq(r[0], {payee: "tesco express", cat: "groceries", confidence: "high"});
  eq(r[1], {payee: "nandos", cat: "eating", confidence: "high"});
});

Deno.test("strips markdown code fences if Haiku wraps the JSON", () => {
  const json = "```json\n[{\"payee\":\"tesco express\",\"cat\":\"groceries\",\"confidence\":\"high\"}]\n```";
  const r = classifyOf(content(json), A);
  eq(r.length, 1);
  eq(r[0].cat, "groceries");
});

Deno.test("unknown category id is dropped", () => {
  const json = JSON.stringify([{payee: "tesco express", cat: "made_up_cat", confidence: "high"}]);
  const r = classifyOf(content(json), A);
  eq(r.length, 0);
});

Deno.test("payee not in input set is dropped", () => {
  const json = JSON.stringify([{payee: "some other shop", cat: "groceries", confidence: "high"}]);
  const r = classifyOf(content(json), A);
  eq(r.length, 0);
});

Deno.test("invalid confidence defaults to low", () => {
  const json = JSON.stringify([{payee: "tesco express", cat: "groceries", confidence: "very_sure"}]);
  const r = classifyOf(content(json), A);
  eq(r.length, 1);
  eq(r[0].confidence, "low");
});

Deno.test("malformed JSON returns empty array", () => {
  eq(classifyOf(content("this is not json"), A), []);
});

Deno.test("empty text returns empty array", () => {
  eq(classifyOf(content(""), A), []);
});

Deno.test("Claude omitting a payee is fine — partial results returned", () => {
  const json = JSON.stringify([{payee: "tesco express", cat: "groceries", confidence: "high"}]);
  const r = classifyOf(content(json), A);
  eq(r.length, 1); // nandos and unknown merchant are simply absent — that's fine
});

Deno.test("non-array JSON returns empty array", () => {
  const json = JSON.stringify({payee: "tesco express", cat: "groceries", confidence: "high"});
  eq(classifyOf(content(json), A), []);
});

Deno.test("text before the array is ignored, array is extracted", () => {
  const json = "Here are the results:\n[{\"payee\":\"tesco express\",\"cat\":\"groceries\",\"confidence\":\"high\"}]";
  const r = classifyOf(content(json), A);
  eq(r.length, 1);
  eq(r[0].cat, "groceries");
});

Deno.test("multiple text blocks are joined and parsed", () => {
  const blocks = [
    {type: "text" as const, text: "[{\"payee\":\"tesco express\","},
    {type: "text" as const, text: "\"cat\":\"groceries\",\"confidence\":\"high\"}]"},
  ];
  const r = classifyOf(blocks, A);
  eq(r.length, 1);
});
