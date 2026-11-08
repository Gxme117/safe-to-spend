// A change to your bills that Tim or Frank proposed (lib/billChange.ts), as a card under his answer: what it's for, exactly what
// changes, any payment it takes, and today's amount before and after. Nothing's saved until you tap its button (or say yes with
// it open); "Not now" leaves everything as it was. Once you've decided, the buttons go and one muted line says what happened.
import {ActivityIndicator, Pressable, Text, View} from "react-native";
import type {ProposalView} from "@/lib/billChange";
import {money} from "@/lib/money";
import {hanken, s} from "@/theme/tokens";
import {useTheme} from "@/theme/useTheme";

export type CardStatus = "open" | "saving" | "done" | "declined" | "unanswered" | "failed" | "stale" | "undone";
const ENDED: Partial<Record<CardStatus, string>> = {
  done: "Done", declined: "Left as it was", unanswered: "Not answered: nothing changed", undone: "Undone: put back as it was",
};

export function BillCard({view, status, note, color, ink = "#FFFFFF", box, edge, disabled, onYes, onNo}: {
  view: ProposalView; status: CardStatus; note?: string; color: string; ink?: string; box: string; edge: string; disabled?: boolean;
  onYes: () => void; onNo: () => void;
}) {
  const {c} = useTheme();
  const open = status === "open" || status === "failed" || status === "saving";
  const t = view.today;
  const today = t && (t.now === t.then ? `Today's amount stays ${money(t.now)}` : `Today's amount: ${money(t.now)} → ${money(t.then)}`);
  const body = {fontFamily: hanken.medium, fontSize: 15, lineHeight: 20, color: c.ink};
  const quiet = {fontFamily: hanken.medium, fontSize: 13, lineHeight: 18, color: c.muted};
  return (
    <View testID="bill-card" style={{alignSelf: "stretch", padding: s[4], gap: s[3], borderRadius: 20, borderCurve: "continuous", borderWidth: 1, borderColor: edge, backgroundColor: box}}>
      <Text accessibilityRole="header" style={{fontFamily: hanken.semibold, fontSize: 17, lineHeight: 22, color: c.ink}}>{view.title}</Text>
      <View style={{gap: s[1]}}>
        {view.rows.map(r => <Text key={r} style={body}>{r}</Text>)}
        {view.files.map(f => <Text key={f} style={quiet}>{f}</Text>)}
      </View>
      {today ? <Text style={body}>{today}</Text> : null}
      {status === "failed" || status === "stale" ? <Text style={quiet}>{note ?? "That didn't save. Try again."}{status === "stale" ? " Ask him again." : ""}</Text> : null}
      {open ? (
        <View style={{flexDirection: "row", gap: s[2]}}>
          <Pressable onPress={onYes} disabled={disabled || status === "saving"} accessibilityRole="button" accessibilityState={{disabled: disabled || status === "saving"}}
            style={{flex: 1, height: 44, borderRadius: 22, borderCurve: "continuous", alignItems: "center", justifyContent: "center", backgroundColor: color, opacity: disabled ? .35 : 1}}>
            {status === "saving" ? <ActivityIndicator color={ink} /> : <Text style={{fontFamily: hanken.semibold, fontSize: 15, color: ink}}>{view.action}</Text>}
          </Pressable>
          <Pressable onPress={onNo} disabled={disabled || status === "saving"} accessibilityRole="button" accessibilityState={{disabled: disabled || status === "saving"}}
            style={{flex: 1, height: 44, borderRadius: 22, borderCurve: "continuous", alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: edge, opacity: disabled ? .35 : 1}}>
            <Text style={{fontFamily: hanken.semibold, fontSize: 15, color: c.ink}}>Not now</Text>
          </Pressable>
        </View>
      ) : ENDED[status] ? <Text style={quiet}>{ENDED[status]}</Text> : null}
    </View>
  );
}
