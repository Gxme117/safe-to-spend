import {figuresOf, visualOf} from "../visual";

const FIG = `<figure label="Spent in October so far">£1,284</figure>`;
const WORDS = "The rest is mostly food.";

test("a figure and its split: drawn, and the tags never show as words", () => {
  expect(visualOf(`${FIG}\n<split>£650 rent | £634 everything else</split>\n\n${WORDS}`)).toEqual({
    text: WORDS,
    visual: {label: "Spent in October so far", amount: 1284, parts: [{amount: 650, name: "rent"}, {amount: 634, name: "everything else"}]},
  });
});

test("a figure on its own is fine; a split on its own is ignored", () => {
  expect(visualOf(`${FIG}\n${WORDS}`)).toEqual({text: WORDS, visual: {label: "Spent in October so far", amount: 1284}});
  expect(visualOf(`<split>£650 rent | £634 everything else</split>\n${WORDS}`)).toEqual({text: WORDS});
});

test("no answer, no picture: the words as they were", () => {
  expect(visualOf(WORDS)).toEqual({text: WORDS});
});

test("a broken figure isn't drawn, but its tags still never show", () => {
  for (const bad of [
    `<figure>£1,284</figure>`,                         // no label
    `<figure label="">£1,284</figure>`,
    `<figure label="Spent">about £1,284</figure>`,      // words beside the figure
    `<figure label="Spent">£1,284 and £20</figure>`,    // two figures
    `<figure label="Spent">lots</figure>`,              // none
  ]) expect(visualOf(`${bad}\n${WORDS}`)).toEqual({text: WORDS});
});

test("a split needs 2 or 3 parts, each a £ figure then words", () => {
  const split = (s: string) => visualOf(`<figure label="Total">£100</figure><split>${s}</split>`).visual?.parts;
  expect(split("£100 rent")).toBeUndefined();
  expect(split("£25 a | £25 b | £25 c | £25 d")).toBeUndefined();
  expect(split("£50 rent | £50")).toBeUndefined();
  expect(split("50 rent | £50 food")).toBeUndefined();
  expect(split("£50 rent | £30 food | £20 the rest")).toHaveLength(3);
});

test("the parts have to add up to the figure, or the split goes and the figure stays", () => {
  const v = visualOf(`${FIG}<split>£650 rent | £600 everything else</split>`).visual;
  expect(v).toEqual({label: "Spent in October so far", amount: 1284});
  // to the penny, or a pound either way when any of them is whole pounds
  expect(visualOf(`<figure label="T">£10.50</figure><split>£5.25 a | £5.25 b</split>`).visual?.parts).toHaveLength(2);
  expect(visualOf(`<figure label="T">£10.50</figure><split>£5.25 a | £5.24 b</split>`).visual?.parts).toBeUndefined();
  expect(visualOf(`<figure label="T">£1,284</figure><split>£651 a | £634 b</split>`).visual?.parts).toHaveLength(2);
});

test("only the first picture counts, and every picture tag is taken out", () => {
  const a = visualOf(`${FIG}\n<figure label="Again">£5</figure>\n${WORDS}`);
  expect(a).toEqual({text: WORDS, visual: {label: "Spent in October so far", amount: 1284}});
});

test("its figures, written so the check reads them", () => {
  expect(figuresOf({label: "T", amount: 1284, parts: [{amount: 650, name: "rent"}, {amount: 634.4, name: "else"}]})).toBe("£1284 £650 £634.4");
});
