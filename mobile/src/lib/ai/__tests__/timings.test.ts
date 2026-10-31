import type {Turn} from "../converse";
import {roundOf, stopwatch} from "../timings";

test("each stage is marked in seconds since Send, in order", () => {
  let t = 1000;
  const clock = stopwatch(() => t);
  t += 3240; clock.mark("round 1 (what_if)");
  t += 2100; clock.mark("round 2 (answer)");
  expect(clock.line()).toBe("round 1 (what_if) 3.2s · round 2 (answer) 5.3s");
});

test("a round says which lookups it asked for, or that it was his answer", () => {
  const asks = {content: [{type: "thinking"}, {type: "tool_use", name: "overview"}, {type: "tool_use", name: "what_if"}], stop_reason: "tool_use"} as unknown as Turn;
  const answers = {content: [{type: "thinking"}, {type: "text", text: "Yes."}], stop_reason: "end_turn"} as unknown as Turn;
  expect(roundOf(1, asks)).toBe("round 1 (overview, what_if)");
  expect(roundOf(2, answers)).toBe("round 2 (answer)");
});
