import {nextOf} from "../next";

const WORDS = "You've £42 left today.";

test("his follow-ups come out of the words, trimmed, and the tag never shows", () => {
  expect(nextOf(`${WORDS}\n\n<next> What about tomorrow? |Can I save more?  </next>`))
    .toEqual({text: WORDS, next: ["What about tomorrow?", "Can I save more?"]});
});

test("none, or none worth offering: the words as they were, the tag still gone", () => {
  expect(nextOf(WORDS)).toEqual({text: WORDS});
  expect(nextOf(`${WORDS}\n<next></next>`)).toEqual({text: WORDS});
  expect(nextOf(`${WORDS}\n<next> | </next>`)).toEqual({text: WORDS});
  expect(nextOf(`${WORDS}\n<next>Unclosed`)).toEqual({text: `${WORDS}\nUnclosed`});
});

test("a £ figure, a long one or a repeat is dropped; at most 3", () => {
  const long = "Could you go through every single bill I have and tell me which ones I could cut?";
  expect(nextOf(`<next>Can I spend £50? | ${long} | Why? | Why? | What's due? | Am I okay? | Next week?</next>`).next)
    .toEqual(["Why?", "What's due?", "Am I okay?"]);
});
