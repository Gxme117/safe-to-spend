// How wide a piece of text is in Hanken Grotesk Medium, without drawing it: each letter's advance width, in thousandths of the
// font size, read off the font file (@expo-google-fonts/hanken-grotesk 500Medium) for printable ASCII, then £ ’ …
// Anything else counts as an "m", the widest, so a guess is never too narrow.
const CHARS = " !\"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~£’…";
const WIDTHS = [
  260, 244, 347, 697, 560, 743, 691, 180, 240, 240, 398, 560, 240, 327, 240, 419, 560, 560, 560, 560, 560, 560, 560, 560, 560, 560,
  240, 240, 560, 560, 560, 516, 874, 649, 604, 706, 679, 583, 563, 732, 683, 252, 553, 644, 498, 845, 680, 748, 557, 778, 603, 568,
  586, 656, 661, 964, 651, 610, 590, 272, 454, 272, 577, 434, 299, 542, 583, 519, 583, 540, 339, 517, 553, 232, 232, 541, 269, 833,
  553, 575, 583, 583, 413, 471, 353, 553, 526, 750, 527, 526, 472, 254, 262, 254, 560, 560, 265, 676,
];
const WIDEST = 833;

/** The width of `text` in Hanken Grotesk Medium at `size` (pt). */
export function hankenWidth(text: string, size: number): number {
  let sum = 0;
  for (const ch of text) {
    const i = CHARS.indexOf(ch);
    sum += i < 0 ? WIDEST : WIDTHS[i];
  }
  return sum * size / 1000;
}
