import {yesNo} from "../yesNo";

test("a plain yes or no, typed or said, is the same as tapping the card", () => {
  for (const t of ["Yes", "yeah.", "Go ahead", "go ahead!", "Do it", "OK", "yes please", "That's right", "Yep, go ahead"]) expect([t, yesNo(t)]).toEqual([t, "yes"]);
  for (const t of ["No", "nah", "Not now", "leave it", "No thanks", "don't"]) expect([t, yesNo(t)]).toEqual([t, "no"]);
});

test("anything more goes to him: figures, a but, a question, or more than a few words", () => {
  for (const t of ["yes but make it £14.99", "yes, 12.99", "maybe", "what's that?", "yes it's my phone contract from Three", "no it's monthly", ""]) {
    expect([t, yesNo(t)]).toEqual([t, "reply"]);
  }
});
