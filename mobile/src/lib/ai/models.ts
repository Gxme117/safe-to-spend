// Which Claude Tim or Frank thinks with, picked on the "+" card, each his own. The phone sends only the key; the accountant
// function maps it to a model (MODELS in its lib.ts) and refuses anything else.
export type ModelKey = "opus" | "sonnet" | "haiku";

/** The ones offered, best first. */
export const MODEL_CHOICES: {key: ModelKey; name: string; note: string}[] = [
  {key: "sonnet", name: "Sonnet 5.5", note: "Smart answers"},
  {key: "opus", name: "Opus 5.5", note: "Best answers"},
  {key: "haiku", name: "Haiku 5.5", note: "Quickest"},
];

export const DEFAULT_MODEL: ModelKey = "sonnet";
