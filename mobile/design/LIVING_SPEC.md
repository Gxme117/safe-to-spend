# Living screen: spec

The **Living** tab of the Pinch budgeting app shows your cost of living as a ball pit of bubbles. Each bubble is a bill or regular expense. **Bigger bubble = costs more.**

- The page answers **"what does my life cost, and what makes it up?"**
- It does not answer "when is it due?". That belongs to the separate **Coming up** tab (a forecast of the months ahead, not designed yet).
- `living-screen.html`, next to this file, is the working reference. Open it in a browser and click around. Add `?empty` to the URL to see the first-run screen.

This spec doesn't depend on any particular tech stack. Match the behaviour and the numbers, and use the platform's own components where they exist.

---

## 1. Layout (iPhone frame, 390 × 844 pt)

From top to bottom:

1. **Header** (16pt side padding, 28pt from the top):
   - Eyebrow: "Your cost of living". 14pt, medium, `#666666`.
   - Total: "£1,394 a month". The amount is 40pt bold with -0.02em tracking. "a month" is 20pt medium, `#666666`.
   - Subline: "£1,245 still to pay before payday". 14pt, `#666666`.
2. **Pit:** fills the space between the header and the tab bar, 358pt wide. Bubbles rest on its floor.
3. **Tab bar:** 4 tabs: Today · **Living** (active) · Coming up · Settings.
   - Has a 1pt top border (`#E3E3E3`) and 54pt-tall buttons with a 24pt icon above a 13pt label.
   - Active tab: `#111111`, bold. Inactive tabs: `#8A857E`, medium.
   - The Living tab icon is three filled circles of different sizes (a mini ball pit).
4. **Home indicator / safe area** below the tab bar.

## 2. Colour and type

| Token | Value | Used for |
|---|---|---|
| ink | `#111111` | bubbles, main text, primary buttons |
| ink-warm | `#2B2A27` | icon on a highlighted bubble, dashed outline of the "+" button |
| muted | `#666666` | secondary text |
| tab-idle | `#8A857E` | inactive tabs, icon on a paid bubble |
| paid | `#E7E4DF` | fill of a paid bubble |
| line | `#E3E3E3` | tab bar border |
| field | `#D6D3CE` | input borders, sheet handle |
| highlight | radial gradient `#FFAD30` (centre) to `#FFD58C` (edge) | selected bubble. Copied from the selected day on the Today calendar |
| danger | `#B42318` | Delete |

- **Font:** Hanken Grotesk (400, 500, 700), falling back to Helvetica Neue / Helvetica.
- **Overall look:** monochrome with one accent. Yellow is the only colour on screen and it always means "selected".

## 3. Bubbles

### Size: area is proportional to cost, with a minimum

- The cheapest item is **44pt across** (minimum, so it can always be tapped).
- The most expensive item is **219pt across**.
- In between, **area grows linearly with the amount**:
  ```
  r(a) = sqrt( rMin² + k·(a − minAmt) ),  where k = (rMax² − rMin²) / (maxAmt − minAmt),  rMin = 22, rMax = 109.5
  ```
- This keeps the order honest: a bigger bill is always a bigger bubble, and two bubbles never tie. Small bills look a little closer in size to each other than they really are, and that trade-off is intentional.
- If there's only one bill, it's 120pt across.

### Layout: a ball pit

- Bubbles sit at the **bottom** of the pit, every one touching its neighbours, like balls that have settled.
- **Algorithm:** sort by amount, biggest first. Drop each circle into the **lowest valid position** where it rests on the floor, a wall, or two other circles (tangent), without overlapping anything. On a tie, prefer the left.
- The "+" button is packed last as a 52pt circle.
- The layout is **recomputed live** whenever bills change (add, edit, delete), and bubbles **animate** to their new spots: 0.45s, `cubic-bezier(.2,.9,.25,1)`.
- **No dragging.** Position comes from size, and anything a user moved would be lost on the next re-pack. A possible future feature: drag one bubble onto another to group them.

### Appearance

- **Default:** solid `#111111` with a white line icon in the centre. No outline, no text inside.
- **Selected:** the yellow highlight gradient, with the icon in `#2B2A27`.
  - Only one bubble is highlighted at a time.
  - When nothing is open, the **last bubble tapped** stays highlighted. Before any tap, the **biggest bill** is highlighted.
- **Paid:** a flat `#E7E4DF` fill with the icon in `#8A857E`. No tick, badge or outline; those were tried and dropped. The sheet and screen-reader label still say "paid".
- **Press:** scale to 0.92 with a springy release (`cubic-bezier(.3,1.6,.5,1)`, 0.18s).

### Icons

- Line icons on a 24pt grid, round caps and joins. One line weight everywhere: **2.25pt on screen**, so the stroke is scaled to cancel out the icon's size.
- **Three sizes**, based on bubble diameter:
  - under 70pt: **18pt** icon
  - 70 to 140pt: **24pt** icon
  - over 140pt: **32pt** icon
- **Optical nudges** for shapes that look too thin or too heavy:
  - water ×1.10
  - gym ×1.08
  - internet (wifi) ×0.94
  - council ×0.94
- **Icon set:** home (rent), basket (food), town hall (council), lightning bolt (energy), train (travel), water drop (water), wifi (internet), dumbbell (fitness), phone (phone), music note (music), screen with play button (TV), briefcase-style "other".
- Subscriptions get generic icons, not brand logos.

## 4. Details sheet

**Tap a bubble** to open a bottom sheet:

- Corner radius 28pt, padding 24pt, a shadow above it, and a handle at the top.
- It slides up in 0.32s.
- At the same time, the **whole pile lifts by the sheet's height**, so the bubbles rest on top of the sheet instead of hiding behind it. Measure the sheet; don't hard-code its height.

The sheet contains:

- A 44pt yellow icon badge and the name (20pt bold).
- The amount in **64pt bold**, the same style as the "£13" on the Today screen.
  - Estimates get a small "About" before them, for example "About £80" for travel and other things that vary.
- The due line, for example "Due Tue 20 Oct, **in 3 days**", "Due today", "Was due Mon 12 Oct" or "Paid · Mon 12 Oct".
- The primary button: "Mark as paid" or "Mark as unpaid". Estimates say "Log spending".
- Secondary buttons: **Edit** and **Delete**.

**To close the sheet:** tap the same bubble again, tap empty space in the pit, tap the handle, or swipe the sheet down (more than 40pt).

## 5. Groups (drill-down)

- A bubble can be a **group**, one item paid several times this month (Groceries: 4 weekly shops). It can also, in future, be several related items (Subscriptions).
- The group's amount is the sum of its payments.

**Tapping a group:**

- Every other bubble fades out.
- The group bubble moves to the centre bottom of the pit.
- Its payments pop out of it into a **row above it**, ordered by date left to right. Each one is sized by its own amount with the same size formula.
  - Paid payments use the paid look.
  - Future payments are estimates ("About £56").
- The sheet shows the summary, for example "About £220 · £109 spent so far · 2 of 4 done", with "Mark next shop as paid".

**Inside a group:**

- Tap a payment to see its own details in the sheet (Mark as paid or unpaid). No edit or delete at this level.
- Tap the big bubble to go back to the group summary.
- Tap empty space to close everything. The payments shrink back into the group bubble.

**Rule:** groups go **one level deep only**. Payments never open further.

## 6. Paid and totals

- The header total is the sum of all bills, plus each group's payments.
- "Still to pay" is the total minus everything marked paid.
- Bubbles **stay in the pile when paid** (they just fade), so the pile always shows the full month. The header number does the counting down.

## 7. Edit and delete

- **Edit** turns the sheet into a form with Name, Amount and Due, plus Cancel and Save.
  - Groups don't have an Amount field, because their amount comes from their payments.
  - Saving a new amount resizes the bubble and re-packs the pile.
- **Delete** removes the bubble right away. The pile re-settles.
  - A dark toast appears above the tab bar: "Netflix removed · **Undo**", for 5 seconds.
  - Undo puts the bubble back where it was.
  - There is no "are you sure?" dialog.

## 8. Add a bill

Tapping the dashed **"+"** bubble opens the "New bill" form in the sheet. This form covers the pile; the pile doesn't lift, because the form is tall.

The form has:

- **Name**, with the placeholder "e.g. Car insurance".
- **Amount (£)** and **Due**, side by side.
- **How often:** a segmented control with Weekly · Monthly (default) · Yearly · One-off. A note underneath explains the effect:
  - **Weekly:** becomes a **group** with 4 weekly payments of that amount ("About £80 a month · opens into 4 weekly payments").
  - **Monthly:** counts once a month.
  - **Yearly:** spread out: the bubble is amount ÷ 12, and the sheet notes "£600 a year".
  - **One-off:** counts this month only.
  - The Due placeholder changes with the choice: "e.g. Saturdays" / "e.g. the 26th" / "e.g. 3 March" / "e.g. Fri 23 Oct".
- **Icon:** a 6 × 2 grid of 44pt black circles, with the chosen one in yellow.
  - **The icon is chosen automatically from the name as you type.** For example: Octopus or EDF → energy, Vodafone or EE → phone, Tesco → food, Car insurance → travel, Netflix or Disney+ → TV. Unknown names get "other".
  - The hint reads "Picked from the name · tap to change".
  - Once the user taps an icon themselves, auto-picking stops ("Your choice").
- **Cancel** and **Add bill**. Add bill stays disabled (grey) until there's a name and an amount above 0.

After adding, the new bubble drops into the pile at its size and is highlighted.

## 9. Empty state

With no bills:

- The "+" grows to **88pt** and sits in the middle of the pit.
- Above it: "**Add your first bill**" (24pt bold), then "Each one becomes a bubble, sized by what it costs. Together they show your cost of living." (15pt, `#666666`).

## 10. Accessibility

- Every bubble is a real button with a label like "Council tax, £120" or "Spotify, £12, paid", and `aria-pressed` when selected.
- Icons are decorative, so they're hidden from screen readers.
- Paid status never relies on colour alone: it's in the label and the sheet text.
- Touch targets are at least 44pt.
- Planned: a **list view toggle** in the header, for people who'd rather scan names than shapes.

## 11. Not built yet

- A proper **date picker** for Due, so countdowns ("in 3 days") work for new bills. Right now the date is free text.
- An "**It varies**" switch when adding, to mark a bill as an estimate.
- A **list view** toggle.
- **Grouping many small bills** (for example Subscriptions), possibly by dragging one bubble onto another.
- An optional **essentials-at-the-bottom** layering: needs settle first, optional extras on top.
- Using the **pay cycle** (30 Sep – 30 Oct) instead of calendar months everywhere, and linking from Today ("£310 spare until payday") to this tab.
