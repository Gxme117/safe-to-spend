// The organisation card in Tim and Frank's chat: "Smart Sort".
// One look for both stages. Preview (nothing saved yet): what was found, what he'd sort, what needs your say.
// Report (saved): what he did, with Undo. Either way: header, three counts, his decisions, his line, the buttons.
import {GlassView} from "expo-glass-effect";
import {useMemo, useState} from "react";
import {ActivityIndicator, Pressable, StyleSheet, Text, View} from "react-native";
import {Icon} from "@/components/Icon";
import {MerchantLogo} from "@/components/TxRow";
import {resolveSubCat} from "@/lib/categories";
import {nice} from "@/lib/found";
import {txLook} from "@/lib/looks";
import type {OrgExample, OrgReport} from "@/lib/organise";
import type {OrgEdits, OrgProposal} from "@/lib/orgProposal";
import type {Ctx} from "@/lib/types";
import {GLASS} from "@/theme/glass";
import {hanken, s} from "@/theme/tokens";
import {useTheme} from "@/theme/useTheme";

export type OrgCardStatus = "open" | "saving" | "done" | "failed" | "cancelled" | "undone";

type Who = "tim" | "frank";
type Palette = ReturnType<typeof useTheme>["c"];

// How many decisions show at first, and how many more each "Show more" adds.
const PAGE = 20;

// Only where nothing else says what happened: an open card is its own status, and a saving one has the button's spinner.
const PILL: Partial<Record<OrgCardStatus, string>> = {
  failed: "Didn't save", done: "Organised", cancelled: "Left as it was", undone: "Undone",
};

// A decision as the card draws it, from either stage.
// `catId`/`subId`/`count` are where a proposed shop's payments are going and how many: what Edit starts from.
type Decision = {key: string; name: string; to: string; review: boolean; logo?: string; look?: ReturnType<typeof txLook>; txId?: string; catId?: string; subId?: string; count?: number};

/** What Edit is asked about: a shop's payments in a preview that isn't saved yet. */
export type EditTarget = {key: string; name: string; cat: string; sub?: string; count: number};

const caps = (c: Palette) => ({fontFamily: hanken.semibold, fontSize: 13, lineHeight: 18, letterSpacing: 0.8, color: c.muted});

// ─── Pieces ───────────────────────────────────────────────────────────────────

const Tile = GLASS ? GlassView : View; // the feature's mark: glass never gets opacity 0 on it or around it, or it stops drawing

function Header({who, status, c, edge}: {who: Who; status: OrgCardStatus; c: Palette; edge: string}) {
  return (
    <View style={{flexDirection: "row", alignItems: "flex-start", gap: s[3]}}>
      {/* the feature's mark, so it reads as a thing Pinch does rather than a message */}
      {/* an app-icon squircle: iOS's corner is about 22% of the side, drawn with the continuous curve */}
      {/* Liquid Glass where the phone has it (iOS 26), else the soft grey tile it was */}
      <Tile {...GLASS ? {glassEffectStyle: "regular" as const} : {}}
        style={[{width: 44, height: 44, borderRadius: 10, borderCurve: "continuous", alignItems: "center", justifyContent: "center"}, GLASS ? null : {backgroundColor: c.soft}]}>
        <Icon name="broom" color={c.ink} size={24} />
      </Tile>
      <View style={{flex: 1, gap: s[1]}}>
        <Text accessibilityRole="header" style={{fontFamily: hanken.semibold, fontSize: 17, lineHeight: 22, color: c.ink}}>Smart Sort</Text>
        <Text style={caps(c)}>{`${who === "tim" ? "TIM" : "FRANK"}'S ORGANISATION`}</Text>
      </View>
      {PILL[status] ? (
        <View style={{height: 28, paddingHorizontal: s[3], borderRadius: 14, borderCurve: "continuous", borderWidth: 1, borderColor: edge, alignItems: "center", justifyContent: "center"}}>
          <Text style={{fontFamily: hanken.semibold, fontSize: 13, color: c.ink}}>{PILL[status]}</Text>
        </View>
      ) : null}
    </View>
  );
}

function Divider({edge}: {edge: string}) {
  return <View style={{height: StyleSheet.hairlineWidth, backgroundColor: edge}} />;
}

function Found({who, count, c}: {who: Who; count: number; c: Palette}) {
  return (
    <View style={{gap: s[1]}} accessible accessibilityLabel={`${who === "tim" ? "Tim" : "Frank"} found ${count} item${count === 1 ? "" : "s"}. Payments and transactions that need attention.`}>
      <Text style={caps(c)}>{`${who === "tim" ? "TIM" : "FRANK"} FOUND`}</Text>
      {/* the biggest figure on the card: how much there is */}
      <View style={{flexDirection: "row", alignItems: "baseline", gap: s[2]}}>
        <Text style={{fontFamily: hanken.semibold, fontSize: 56, lineHeight: 62, color: c.ink, fontVariant: ["tabular-nums"]}}>{count}</Text>
        <Text style={{fontFamily: hanken.semibold, fontSize: 48, lineHeight: 54, color: c.ink}}>{count === 1 ? "item" : "items"}</Text>
      </View>
      <Text style={{fontFamily: hanken.medium, fontSize: 13, lineHeight: 18, color: c.muted}}>Payments and transactions that need attention.</Text>
    </View>
  );
}

function Counts({auto, review, left, c, edge}: {auto: number; review: number; left: number; c: Palette; edge: string}) {
  const tile = (n: number, label: string) => (
    <View key={label} accessible accessibilityLabel={`${n} ${label}`}
      style={{flex: 1, gap: s[1], padding: s[3], borderRadius: 18, borderCurve: "continuous", borderWidth: 1, borderColor: edge}}>
      <Text style={{fontFamily: hanken.semibold, fontSize: 24, lineHeight: 30, color: c.ink, fontVariant: ["tabular-nums"]}}>{n}</Text>
      <Text numberOfLines={1} style={{fontFamily: hanken.medium, fontSize: 13, lineHeight: 18, color: c.muted}}>{label}</Text>
    </View>
  );
  return <View style={{flexDirection: "row", gap: s[2]}}>{tile(auto, "Auto-sorted")}{tile(review, "Needs review")}{tile(left, "Can't place")}</View>;
}

// "Sorted" and its tick, at the right of a payment he sorted for sure: a fixed width, so a column of them lines up
const DONE_WIDTH = 76;

function Done() {
  const {c} = useTheme();
  return (
    <View accessible accessibilityLabel="Sorted" style={{width: DONE_WIDTH, height: 24, flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: s[1]}}>
      <Text style={{fontFamily: hanken.medium, fontSize: 13, color: c.muted}}>Sorted</Text>
      <Icon name="check" color={c.muted} size={20} />
    </View>
  );
}

function Chip({c}: {c: Palette}) {
  return (
    // same width and right edge as "Sorted", so the two line up down the list
    <View style={{width: DONE_WIDTH, height: 24, flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: s[1]}}>
      <Text style={{fontFamily: hanken.heavy, fontSize: 13, color: c.ink}}>Review</Text>
      <Icon name="forward" color={c.ink} size={16} />
    </View>
  );
}

/** One decision: where it went and how sure he was. The whole row is the way to change it. */
function Row({d, c, edge, first, onPress}: {
  d: Decision; c: Palette; edge: string; first: boolean; onPress: () => void;
}) {
  return (
    <Pressable testID={d.txId ? `org-row-${d.txId}` : `org-group-${d.key}`} onPress={onPress} accessibilityRole="button"
      accessibilityLabel={`${d.name}, ${d.to}${d.review ? ", to review" : ""}. Edit`}
      style={({pressed}) => ({flexDirection: "row", alignItems: "center", gap: s[3], paddingVertical: s[3], borderTopWidth: first ? 0 : 1, borderColor: edge, opacity: pressed ? 0.6 : 1})}>
      <MerchantLogo name={d.name} uri={d.logo} look={d.look} />
      <View style={{flex: 1, minWidth: 0}}>
        <Text numberOfLines={1} style={{fontFamily: hanken.medium, fontSize: 15, lineHeight: 20, color: c.ink}}>{d.name}</Text>
        <Text numberOfLines={1} style={{fontFamily: hanken.medium, fontSize: 13, lineHeight: 18, color: c.muted}}>{d.to}</Text>
      </View>
      {d.review ? <Chip c={c} /> : <Done />}
    </Pressable>
  );
}

function Decisions({who, shown, more, onMore, c, edge, children}: {
  who: Who; shown: Decision[]; more: number; onMore: () => void;
  c: Palette; edge: string; children: (d: Decision, i: number) => React.ReactNode;
}) {
  return (
    <View style={{gap: s[2]}}>
      <Text accessibilityRole="header" style={{fontFamily: hanken.semibold, fontSize: 17, lineHeight: 22, color: c.ink}}>{`${who === "tim" ? "Tim" : "Frank"}'s decisions`}</Text>
      <View>{shown.map(children)}</View>
      {more > 0 ? (
        <Pressable onPress={onMore} accessibilityRole="button" accessibilityLabel={`Show ${more} more`} style={{paddingVertical: s[2], borderTopWidth: 1, borderColor: edge}}>
          <Text style={{fontFamily: hanken.semibold, fontSize: 13, color: c.ink}}>{`Show ${more} more`}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function Button({label, onPress, disabled, busy, color, ink = "#FFFFFF", edge, c, quiet, neutral}: {
  label: string; onPress: () => void; disabled?: boolean; busy?: boolean; color: string; ink?: string; edge: string; c: Palette; quiet?: boolean;
  neutral?: boolean; // a filled button in the theme's own grey rather than the accountant's colour: for "look first" steps
}) {
  return (
    <Pressable onPress={onPress} disabled={disabled} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{disabled: !!disabled}}
      style={{height: 48, borderRadius: 24, borderCurve: "continuous", alignItems: "center", justifyContent: "center", opacity: disabled ? 0.35 : 1,
        ...(quiet ? {borderWidth: 1, borderColor: edge} : {backgroundColor: neutral ? c.soft : color})}}>
      {busy ? <ActivityIndicator color={ink} />
        : <Text style={{fontFamily: hanken.semibold, fontSize: 15, color: quiet || neutral ? c.ink : ink}}>{label}</Text>}
    </Pressable>
  );
}

const frame = (box: string, edge: string) => ({alignSelf: "stretch" as const, padding: s[4], gap: s[5], borderRadius: 20, borderCurve: "continuous" as const, borderWidth: 1, borderColor: edge, backgroundColor: box});

// ─── Preview: nothing is saved until they confirm ─────────────────────────────

function PreviewCard({who, proposal, status, edits, ctx, color, ink, box, edge, disabled, onConfirm, onCancel, onEditGroup}: {
  who: Who; proposal: OrgProposal; status: OrgCardStatus; edits: OrgEdits; ctx: Ctx;
  color: string; ink?: string; box: string; edge: string; disabled?: boolean;
  onConfirm: () => void; onCancel: () => void; onEditGroup: (t: EditTarget) => void;
}) {
  const {c} = useTheme();
  const {preview} = proposal;
  const open = status === "open" || status === "saving" || status === "failed";

  // each shop's payments as they'll be filed: where he'd put them, or where they've been told to go
  const rows: Decision[] = useMemo(() => preview.examples.map((e: OrgExample) => {
    const picked = edits[e.key];
    const cats = ctx.state.categories;
    const catId = picked ? picked.cat : e.toCatId, subId = picked ? picked.sub : e.toSubId;
    const cat = picked ? cats.find(x => x.id === picked.cat)?.name ?? "General" : e.toCatName;
    const sub = picked ? (picked.sub ? resolveSubCat(cats, picked.cat, picked.sub)?.name : undefined) : e.toSubName;
    return {key: e.key, name: e.note, review: e.confidence === "medium" && !picked, catId, subId, count: e.count, to: sub ? `${cat} → ${sub}` : cat};
  }), [preview.examples, edits, ctx.state.categories]);

  // one you've chosen for is no longer his guess
  const moved = preview.examples.filter(e => e.confidence === "medium" && edits[e.key]).reduce((n, e) => n + e.count, 0);
  const busy = status === "saving";
  // a page of shops at a time, the rest behind "Show N more"
  const [cap, setCap] = useState(PAGE);
  const shown = rows.slice(0, cap);

  return (
    <View testID="org-card-preview" style={frame(box, edge)}>
      <Header who={who} status={status} c={c} edge={edge} />
      <Divider edge={edge} />
      <Found who={who} count={preview.total} c={c} />
      <Counts auto={preview.high + moved} review={preview.medium - moved} left={preview.low} c={c} edge={edge} />
      {rows.length ? (
        <Decisions who={who} shown={shown} more={rows.length - shown.length} c={c} edge={edge} onMore={() => setCap(n => n + PAGE)}>
          {(d, i) => (
            <Row key={d.key} d={d} c={c} edge={edge} first={i === 0}
              onPress={() => onEditGroup({key: d.key, name: d.name, cat: d.catId!, sub: d.subId, count: d.count ?? 1})} />
          )}
        </Decisions>
      ) : null}
      {preview.more > 0 ? (
        <Text style={{fontFamily: hanken.medium, fontSize: 13, lineHeight: 18, color: c.muted}}>{`…and ${preview.more} more after the first 500`}</Text>
      ) : null}
      {status === "failed" ? <Text style={{fontFamily: hanken.medium, fontSize: 13, lineHeight: 18, color: c.muted}}>{"That didn't save. Try again."}</Text> : null}
      {open ? (
        <View style={{gap: s[2]}}>
          <Button label="Confirm" onPress={onConfirm} disabled={disabled || busy} busy={busy} color={color} ink={ink} edge={edge} c={c} />
          <Button label="Cancel" onPress={onCancel} disabled={disabled || busy} color={color} edge={edge} c={c} quiet />
        </View>
      ) : null}
    </View>
  );
}

// ─── Report: what he did, as it's filed now ───────────────────────────────────

function ReportCard({who, report, status, ctx, color, box, edge, onUndo, onEdit}: {
  who: Who; report: OrgReport; status: OrgCardStatus; ctx: Ctx; color: string; box: string; edge: string; onUndo: () => void; onEdit: (txId: string) => void;
}) {
  const {c} = useTheme();
  const undone = status === "undone";
  const [cap, setCap] = useState(PAGE);

  // every payment this run sorted, as it's filed now: an edit moves it on its own
  const rows: Decision[] = useMemo(() => {
    const byId = new Map(ctx.txs.map(t => [t.id, t]));
    const check = new Set(report.check.map(r => r.txId));
    const all = (report.rows ?? []).flatMap(id => {
      const t = byId.get(id);
      if (!t) return [];
      const cat = ctx.state.categories.find(x => x.id === t.cat)?.name ?? "General";
      const sub = t.subCat ? resolveSubCat(ctx.state.categories, t.cat, t.subCat)?.name : undefined;
      return [{key: t.id, txId: t.id, name: nice(t.note) || "Payment", to: sub ? `${cat} → ${sub}` : cat, review: check.has(t.id), logo: t.logo, look: txLook(ctx, t)}];
    });
    // the ones to look at first, as in the preview
    return [...all.filter(d => d.review), ...all.filter(d => !d.review)];
  }, [report.rows, report.check, ctx]);

  const shown = rows.slice(0, cap);
  const more = rows.length - shown.length;

  return (
    <View testID="org-card-report" style={frame(box, edge)}>
      <Header who={who} status={status} c={c} edge={edge} />
      {undone ? null : (
        <>
          <Divider edge={edge} />
          <Found who={who} count={report.reviewed} c={c} />
          <Counts auto={report.auto} review={report.provisional} left={report.left} c={c} edge={edge} />
          {rows.length ? (
            <Decisions who={who} shown={shown} more={more} c={c} edge={edge} onMore={() => setCap(n => n + PAGE)}>
              {(d, i) => <Row key={d.key} d={d} c={c} edge={edge} first={i === 0} onPress={() => onEdit(d.txId!)} />}
            </Decisions>
          ) : null}
          {report.more > 0 ? <Text style={{fontFamily: hanken.medium, fontSize: 13, lineHeight: 18, color: c.muted}}>{`${report.more} more still waiting`}</Text> : null}
          {status === "done" ? <Button label="Undo" onPress={onUndo} color={color} edge={edge} c={c} quiet /> : null}
        </>
      )}
    </View>
  );
}

// ─── Public export ────────────────────────────────────────────────────────────

export function OrgCard({who, proposal, status, report, ctx, edits, color, ink, box, edge, disabled, onConfirm, onCancel, onUndo, onEdit, onEditGroup}: {
  who: Who;
  proposal: OrgProposal;
  status: OrgCardStatus;
  report?: OrgReport;
  ctx: Ctx;            // where each sorted payment is filed now, and its logo
  onEdit: (txId: string) => void;       // a payment that's been sorted (the report)
  edits?: OrgEdits;                     // where you've told it to put a shop's payments, before it's saved
  onEditGroup: (t: EditTarget) => void; // Edit on a shop in the preview
  color: string;
  ink?: string;        // the text on a `color` button
  box: string;
  edge: string;
  disabled?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  onUndo: () => void;
}) {
  if (status === "done" || status === "undone") {
    if (!report) return null;
    return <ReportCard who={who} report={report} status={status} ctx={ctx} color={color} box={box} edge={edge} onUndo={onUndo} onEdit={onEdit} />;
  }
  return (
    <PreviewCard who={who} proposal={proposal} status={status} edits={edits ?? {}} ctx={ctx} color={color} ink={ink} box={box} edge={edge}
      disabled={disabled} onConfirm={onConfirm} onCancel={onCancel} onEditGroup={onEditGroup} />
  );
}
