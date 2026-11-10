// What you might ask next, as chips you tap to send: follow-ups under his latest answer. He writes them after it, before his
// <say>, as
//     <next>What about next week? | Can I save more?</next>
// The tag never shows as words. A follow-up with a £ in it is dropped (nothing unchecked is ever offered), and so is one
// that's too long for a chip. Pure.

const NEXT = /<next>([\s\S]*?)<\/next>/g;
const MAX = {count: 3, chars: 60};

/** The answer without its <next> tag, and the follow-ups worth offering, when there are any. */
export function nextOf(text: string): {text: string; next?: string[]} {
  const said = [...text.matchAll(NEXT)].pop()?.[1];
  const shown = text.replace(NEXT, "").replace(/<\/?next>/g, "").replace(/^[ \t]+/gm, "").replace(/\n{3,}/g, "\n\n").trim();
  const next = [...new Set((said ?? "").split("|").map(s => s.replace(/\s+/g, " ").trim()))]
    .filter(s => s && !s.includes("£") && s.length <= MAX.chars)
    .slice(0, MAX.count);
  return next.length ? {text: shown, next} : {text: shown};
}
