// The accountants' calculator: plain arithmetic they can show their working with, so every figure they work out can be checked.
// A small parser (numbers, + - * /, brackets), never eval. "£1,234.50" reads as 1234.5.
import {r2} from "../money";

const MAX = 200;

/** The value of an expression to the penny, or what's wrong with it. */
export function sum(expression: string): {value: number} | {error: string} {
  if (expression.length > MAX) return {error: "That's too long to work out in one go. Break it into smaller sums."};
  const src = expression.replace(/£/g, "").replace(/(\d),(?=\d{3}\b)/g, "$1").replace(/×/g, "*").replace(/÷/g, "/").replace(/−/g, "-");
  let i = 0;
  const skip = () => { while (src[i] === " ") i++; };
  const fail = (why: string): never => { throw new Error(why); };

  const number = () => {
    skip();
    const m = /^\d+(\.\d+)?|^\.\d+/.exec(src.slice(i));
    if (!m) fail(i < src.length ? `I can't read "${src.slice(i, i + 8)}". Only numbers, + - * / and brackets.` : "It ends too early.");
    i += m![0].length;
    return Number(m![0]);
  };
  const factor = (): number => {
    skip();
    if (src[i] === "-") { i++; return -factor(); }
    if (src[i] === "+") { i++; return factor(); }
    if (src[i] === "(") {
      i++;
      const v = expr();
      skip();
      if (src[i] !== ")") fail("A bracket isn't closed.");
      i++;
      return v;
    }
    return number();
  };
  const term = (): number => {
    let v = factor();
    for (;;) {
      skip();
      const op = src[i];
      if (op !== "*" && op !== "/") return v;
      i++;
      const r = factor();
      if (op === "/" && r === 0) fail("That divides by zero.");
      v = op === "*" ? v * r : v / r;
    }
  };
  function expr(): number {
    let v = term();
    for (;;) {
      skip();
      const op = src[i];
      if (op !== "+" && op !== "-") return v;
      i++;
      v = op === "+" ? v + term() : v - term();
    }
  }

  try {
    if (!src.trim()) return {error: "There's nothing to work out."};
    const v = expr();
    skip();
    if (i < src.length) fail(src[i] === ")" ? "There's a bracket too many." : `I can't read "${src.slice(i, i + 8)}". Only numbers, + - * / and brackets.`);
    if (!Number.isFinite(v)) return {error: "That doesn't come to a number."};
    return {value: r2(v)};
  } catch (e) {
    return {error: e instanceof Error ? e.message : "I can't work that out."};
  }
}
