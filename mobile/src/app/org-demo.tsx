// Development only: the Smart Sort card from Tim and Frank's chat, drawn with made-up payments in every state, so it can be
// looked at and adjusted with no question asked and no AI credits spent. Nothing here is saved or sent anywhere.
import {useMemo, useState} from "react";
import {Pressable, ScrollView, Text, View} from "react-native";
import {CategoryPick} from "@/components/CategoryPick";
import {OrgCard, type EditTarget, type OrgCardStatus} from "@/components/OrgCard";
import type {OrgExample, OrgReport} from "@/lib/organise";
import type {OrgEdits} from "@/lib/orgProposal";
import type {Ctx, Tx} from "@/lib/types";
import {useMoney} from "@/store/useMoney";
import {hanken, s, timPage} from "@/theme/tokens";
import {useTheme} from "@/theme/useTheme";

type Who = "frank" | "tim";

// name, amount, category id, sub name, how sure
const SAMPLE: [string, number, string, string | undefined, "high" | "medium"][] = [
  ["Tesco", 14.2, "groceries", "Supermarket", "high"],
  ["Aldi", 31.85, "groceries", undefined, "high"],
  ["Costa", 3.6, "coffee", undefined, "high"],
  ["Greggs", 2.9, "coffee", undefined, "high"],
  ["Netflix", 10.99, "entertainment", "Subscriptions", "medium"],
  ["AMZN MKTP", 23.4, "shopping", undefined, "medium"],
  ["Pets at Home", 18.5, "pets", undefined, "medium"],
  ["Spotify", 11.99, "entertainment", "Subscriptions", "medium"],
];

export default function OrgDemo() {
  const {c, dark} = useTheme();
  const state = useMoney(st => st.state);
  const today = useMoney(st => st.today);
  const tone = timPage[dark ? "dark" : "light"];

  const [who, setWho] = useState<Who>("frank");
  const [status, setStatus] = useState<OrgCardStatus>("open");
  const [many, setMany] = useState(false);
  const [edits, setEdits] = useState<OrgEdits>({});
  const [picking, setPicking] = useState<EditTarget | null>(null);

  const data = useMemo(() => {
    const reps = many ? 3 : 1;
    const txs: Tx[] = [];
    const examples: OrgExample[] = [];
    SAMPLE.forEach(([note, amount, cat, sub, confidence], i) => {
      for (let k = 0; k < reps; k++) {
        txs.push({id: `demo-${i}-${k}`, type: "expense", amount, cat, subCat: sub ? `${cat}/${sub.toLowerCase()}` : undefined, note,
          date: today, created: i * 10 + k});
      }
      examples.push({key: note.toLowerCase(), note, toCatId: cat, toCatName: state?.categories.find(x => x.id === cat)?.name ?? cat,
        toSubName: sub, confidence, count: reps});
    });
    const high = txs.filter((_, i) => SAMPLE[Math.floor(i / reps)][4] === "high").length;
    const medium = txs.length - high;
    const report: OrgReport = {
      runId: "demo", at: 0, reviewed: txs.length + 2, auto: high, provisional: medium, left: 2, more: 0, failed: 0, byCat: [],
      check: txs.filter((_, i) => SAMPLE[Math.floor(i / reps)][4] === "medium")
        .map(t => ({txId: t.id, note: t.note, date: t.date, amount: t.amount, to: t.cat, why: "Name matches"})),
      unclear: [], rows: txs.map(t => t.id),
    };
    return {txs, report, proposal: {preview: {runId: "demo", high, medium, low: 2, total: txs.length + 2, more: 0, examples}}};
  }, [many, today, state]);

  if (!__DEV__ || !state) return null;
  const ctx: Ctx = {state, txs: data.txs, today};

  const chip = (label: string, on: boolean, press: () => void) => (
    <Pressable key={label} onPress={press} accessibilityRole="button" accessibilityState={{selected: on}}
      style={{height: 36, paddingHorizontal: s[3], borderRadius: 18, borderCurve: "continuous", borderWidth: 1, borderColor: tone.edge, justifyContent: "center",
        backgroundColor: on ? tone.send : tone.box}}>
      <Text style={{fontFamily: hanken.semibold, fontSize: 13, color: on ? tone.sendInk : c.ink}}>{label}</Text>
    </Pressable>
  );
  const reset = () => { setStatus("open"); setEdits({}); };

  return (
    <ScrollView style={{backgroundColor: tone.page}} contentContainerStyle={{padding: s[4], gap: s[4], paddingBottom: s[7]}}>
      <View style={{flexDirection: "row", flexWrap: "wrap", gap: s[2]}}>
        {chip("Frank", who === "frank", () => setWho("frank"))}
        {chip("Tim", who === "tim", () => setWho("tim"))}
        {chip(many ? "24 payments" : "8 payments", many, () => setMany(m => !m))}
      </View>
      <View style={{flexDirection: "row", flexWrap: "wrap", gap: s[2]}}>
        {chip("Before saving", status === "open", () => { setStatus("open"); })}
        {chip("Saved", status === "done", () => setStatus("done"))}
        {chip("Undone", status === "undone", () => setStatus("undone"))}
        {chip("Cancelled", status === "cancelled", () => setStatus("cancelled"))}
        {chip("Didn't save", status === "failed", () => setStatus("failed"))}
      </View>
      <OrgCard who={who} proposal={data.proposal} status={status} report={data.report} ctx={ctx} edits={edits}
        color={tone.send} ink={tone.sendInk} box={tone.box} edge={tone.edge}
        onConfirm={() => setStatus("done")} onCancel={() => setStatus("cancelled")} onUndo={() => setStatus("undone")}
        onEdit={id => useMoney.getState().notify(`Would open ${id}`)} onEditGroup={setPicking} />
      <CategoryPick target={picking} state={state} onClose={() => setPicking(null)}
        onPick={(key, cat, sub) => setEdits(e => ({...e, [key]: {cat, ...(sub ? {sub} : {})}}))} />
      <Pressable onPress={reset} accessibilityRole="button" style={{alignSelf: "center", padding: s[2]}}>
        <Text style={{fontFamily: hanken.medium, fontSize: 13, color: c.muted}}>Start again</Text>
      </Pressable>
    </ScrollView>
  );
}
