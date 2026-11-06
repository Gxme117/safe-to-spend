// A category change that Frank or Tim proposed (lib/categoryChange.ts), as a card under his answer: what changes, and buttons
// to confirm or decline. Nothing's saved until you tap yes (or say yes); "Not now" leaves everything as it was.
import {ActivityIndicator, Pressable, Text, View} from "react-native";
import type {Category, CategoryProposal} from "@/lib/types";
import {money} from "@/lib/money";
import {hanken, s} from "@/theme/tokens";
import {useTheme} from "@/theme/useTheme";
import type {CardStatus} from "./BillCard";

export {CardStatus};

function catName(cats: Category[], id: string): string {
  return cats.find(x => x.id === id)?.name ?? id;
}

function payeeName(payee: string): string {
  return payee.replace(/\b\w/g, c => c.toUpperCase());
}

function cardTitle(cats: Category[], p: CategoryProposal): string {
  if (p.kind === "refile") return `Move to ${catName(cats, p.toCat)}`;
  if (p.kind === "merchant_rule") return `Always file ${payeeName(p.payee)}`;
  if (p.kind === "add_cat") return `Add "${p.name}"`;
  return `Rename to "${p.newName}"`;
}

function cardRows(cats: Category[], p: CategoryProposal): string[] {
  if (p.kind === "refile") return [`${money(p.amount)} to "${p.note}" on ${p.date}`, `From ${catName(cats, p.fromCat)} → ${catName(cats, p.toCat)}`];
  if (p.kind === "merchant_rule") return [`Future payments from "${payeeName(p.payee)}" will be filed as ${catName(cats, p.cat)}`];
  if (p.kind === "add_cat") return [`New spending category: "${p.name}"`];
  return [`Rename "${p.oldName}" to "${p.newName}"`];
}

function cardAction(p: CategoryProposal): string {
  if (p.kind === "refile") return "Move it";
  if (p.kind === "merchant_rule") return "Save rule";
  if (p.kind === "add_cat") return "Add category";
  return "Rename";
}

const ENDED: Partial<Record<CardStatus, string>> = {
  done: "Done", declined: "Left as it was", unanswered: "Not answered: nothing changed", undone: "Undone: put back as it was",
};

export function CategoryCard({proposal, cats, status, note, color, box, edge, disabled, onYes, onNo}: {
  proposal: CategoryProposal; cats: Category[]; status: CardStatus; note?: string; color: string; box: string; edge: string; disabled?: boolean;
  onYes: () => void; onNo: () => void;
}) {
  const {c} = useTheme();
  const open = status === "open" || status === "failed" || status === "saving";
  const body = {fontFamily: hanken.medium, fontSize: 15, lineHeight: 20, color: c.ink};
  const quiet = {fontFamily: hanken.medium, fontSize: 13, lineHeight: 18, color: c.muted};
  const rows = cardRows(cats, proposal);
  return (
    <View testID="category-card" style={{alignSelf: "stretch", padding: s[4], gap: s[3], borderRadius: 20, borderWidth: 1, borderColor: edge, backgroundColor: box}}>
      <Text accessibilityRole="header" style={{fontFamily: hanken.semibold, fontSize: 17, lineHeight: 22, color: c.ink}}>{cardTitle(cats, proposal)}</Text>
      <View style={{gap: s[1]}}>
        {rows.map(r => <Text key={r} style={body}>{r}</Text>)}
      </View>
      {status === "failed" || status === "stale" ? <Text style={quiet}>{note ?? "That didn't save. Try again."}{status === "stale" ? " Ask him again." : ""}</Text> : null}
      {open ? (
        <View style={{flexDirection: "row", gap: s[2]}}>
          <Pressable onPress={onYes} disabled={disabled || status === "saving"} accessibilityRole="button" accessibilityState={{disabled: disabled || status === "saving"}}
            style={{flex: 1, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", backgroundColor: color, opacity: disabled ? .35 : 1}}>
            {status === "saving" ? <ActivityIndicator color="#FFFFFF" /> : <Text style={{fontFamily: hanken.semibold, fontSize: 15, color: "#FFFFFF"}}>{cardAction(proposal)}</Text>}
          </Pressable>
          <Pressable onPress={onNo} disabled={disabled || status === "saving"} accessibilityRole="button" accessibilityState={{disabled: disabled || status === "saving"}}
            style={{flex: 1, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: edge, opacity: disabled ? .35 : 1}}>
            <Text style={{fontFamily: hanken.semibold, fontSize: 15, color: c.ink}}>Not now</Text>
          </Pressable>
        </View>
      ) : ENDED[status] ? <Text style={quiet}>{ENDED[status]}</Text> : null}
    </View>
  );
}
