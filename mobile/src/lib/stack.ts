/** The wallet's cards, front first: a tapped card comes to the front and the rest keep the order you last used them in. */
export const bringToFront = (order: number[], i: number) => order[0] === i ? order : [i, ...order.filter(x => x !== i)];

/** The order a stack of `n` cards starts in: the last one (ours) in front, then the one just above it, and so on up. */
export const startOrder = (n: number) => Array.from({length: n}, (_, k) => n - 1 - k);

/** Day 2's stack opening: card `i` comes to the front and every other card comes out in front of `back` (the days to payday), which goes to the back.
 *  Tapping `back` puts it in front again (`bringToFront`), tucking the cards away in the order you last used them. */
export const bringOut = (order: number[], i: number, back: number) => [...bringToFront(order, i).filter(x => x !== back), back];
