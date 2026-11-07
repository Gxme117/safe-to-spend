// Organisation preview and report card for Tim and Frank's chat. The preview shows counts before anything is saved;
// the report appears after they confirm, with a category breakdown and a list of payments to review.
import {ActivityIndicator, Pressable, Text, View} from "react-native";
import {useRouter} from "expo-router";
import type {OrgPreview, OrgReport} from "@/lib/organise";
import type {OrgProposal} from "@/lib/orgProposal";
import {confidenceNote} from "@/lib/orgProposal";
import {money} from "@/lib/money";
import {hanken, s} from "@/theme/tokens";
import {useTheme} from "@/theme/useTheme";

export type OrgCardStatus = "open" | "saving" | "done" | "failed" | "cancelled" | "undone";

const ENDED: Partial<Record<OrgCardStatus, string>> = {
  cancelled: "Left as it was",
  failed: "That didn't save. Try again.",
};

function CountRow({label, count, icon, color}: {label: string; count: number; icon: string; color: string}) {
  const {c} = useTheme();
  return (
    <View style={{flexDirection: "row", alignItems: "center", gap: s[2]}}>
      <Text style={{fontSize: 15, color}}>{icon}</Text>
      <Text style={{flex: 1, fontFamily: hanken.medium, fontSize: 15, lineHeight: 20, color: c.ink}}>{label}</Text>
      <Text style={{fontFamily: hanken.semibold, fontSize: 15, lineHeight: 20, color: c.ink}}>{count}</Text>
    </View>
  );
}

function PreviewCard({preview, status, color, box, edge, disabled, onConfirm, onCancel}: {
  preview: OrgPreview; status: OrgCardStatus; color: string; box: string; edge: string; disabled?: boolean;
  onConfirm: () => void; onCancel: () => void;
}) {
  const {c} = useTheme();
  const open = status === "open" || status === "saving" || status === "failed";
  const quiet = {fontFamily: hanken.medium, fontSize: 13, lineHeight: 18, color: c.muted};
  return (
    <View testID="org-card-preview" style={{alignSelf: "stretch", padding: s[4], gap: s[3], borderRadius: 20, borderWidth: 1, borderColor: edge, backgroundColor: box}}>
      <Text accessibilityRole="header" style={{fontFamily: hanken.semibold, fontSize: 17, lineHeight: 22, color: c.ink}}>
        {`Payments to organise · ${preview.total}`}
      </Text>
      <View style={{gap: s[2]}}>
        <CountRow label="Automatic" count={preview.high} icon="✓" color={c.good} />
        <CountRow label="Needs a check" count={preview.medium} icon="◎" color={c.muted} />
        <CountRow label="Skipped" count={preview.low} icon="–" color={c.muted} />
      </View>
      {preview.more > 0 ? (
        <Text style={quiet}>{`…and ${preview.more} more after the first 500`}</Text>
      ) : null}
      <Text style={quiet}>{confidenceNote()}</Text>
      {status === "failed" ? <Text style={quiet}>{"That didn't save. Try again."}</Text> : null}
      {open ? (
        <View style={{flexDirection: "row", gap: s[2]}}>
          <Pressable onPress={onConfirm} disabled={disabled || status === "saving"} accessibilityRole="button"
            accessibilityLabel="Organise payments"
            accessibilityState={{disabled: disabled || status === "saving"}}
            style={{flex: 1, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", backgroundColor: color, opacity: disabled ? .35 : 1}}>
            {status === "saving" ? <ActivityIndicator color="#FFFFFF" /> : <Text style={{fontFamily: hanken.semibold, fontSize: 15, color: "#FFFFFF"}}>Organise payments</Text>}
          </Pressable>
          <Pressable onPress={onCancel} disabled={disabled || status === "saving"} accessibilityRole="button"
            accessibilityLabel="Cancel"
            accessibilityState={{disabled: disabled || status === "saving"}}
            style={{flex: 1, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: edge, opacity: disabled ? .35 : 1}}>
            <Text style={{fontFamily: hanken.semibold, fontSize: 15, color: c.ink}}>Cancel</Text>
          </Pressable>
        </View>
      ) : ENDED[status] ? <Text style={quiet}>{ENDED[status]}</Text> : null}
    </View>
  );
}

function ReportCard({report, status, edge, box, onUndo}: {
  report: OrgReport; status: OrgCardStatus; edge: string; box: string; onUndo: () => void;
}) {
  const {c} = useTheme();
  const router = useRouter();
  const done = report.auto + report.provisional;
  const quiet = {fontFamily: hanken.medium, fontSize: 13, lineHeight: 18, color: c.muted};
  const body = {fontFamily: hanken.medium, fontSize: 15, lineHeight: 20, color: c.ink};
  const topCats = report.byCat.slice(0, 5);
  const restCount = report.byCat.length - topCats.length;
  return (
    <View testID="org-card-report" style={{alignSelf: "stretch", padding: s[4], gap: s[3], borderRadius: 20, borderWidth: 1, borderColor: edge, backgroundColor: box}}>
      <Text accessibilityRole="header" style={{fontFamily: hanken.semibold, fontSize: 17, lineHeight: 22, color: c.ink}}>
        {status === "undone" ? "Undone" : "Organised"}
      </Text>
      {/* Summary row */}
      <View style={{gap: s[1]}}>
        {done > 0 ? <Text style={body}>{`${done} payment${done === 1 ? "" : "s"} organised`}</Text> : null}
        {report.provisional > 0 ? <Text style={quiet}>{`${report.provisional} to review`}</Text> : null}
        {report.left > 0 ? <Text style={quiet}>{`${report.left} skipped`}</Text> : null}
        {report.more > 0 ? <Text style={quiet}>{`${report.more} more still waiting`}</Text> : null}
      </View>
      {/* Category breakdown */}
      {topCats.length > 0 && status !== "undone" ? (
        <View style={{gap: s[1]}}>
          {topCats.map(cat => (
            <View key={cat.cat} style={{flexDirection: "row", alignItems: "center", gap: s[2]}}>
              <Text style={{flex: 1, ...body}}>{cat.name}</Text>
              <Text style={quiet}>{`${cat.count} · ${money(cat.total)}`}</Text>
            </View>
          ))}
          {restCount > 0 ? <Text style={quiet}>{`…and ${restCount} more ${restCount === 1 ? "category" : "categories"}`}</Text> : null}
        </View>
      ) : null}
      {/* Provisional payments to review */}
      {report.check.length > 0 && status !== "undone" ? (
        <View style={{gap: s[1]}}>
          <Text style={quiet}>To review:</Text>
          {report.check.slice(0, 5).map(row => (
            <Pressable key={row.txId} onPress={() => router.push(`/payment/${row.txId}`)} accessibilityRole="link"
              accessibilityLabel={`Review ${row.note}`}
              style={{flexDirection: "row", alignItems: "center", gap: s[2]}}>
              <Text style={{flex: 1, ...body}}>{row.note}</Text>
              <Text style={quiet}>{money(row.amount)}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      {report.unclear.length > 0 && status !== "undone" ? (
        <Text style={quiet}>{`${report.unclear.length} payment${report.unclear.length === 1 ? "" : "s"} left for you to sort`}</Text>
      ) : null}
      {/* Undo button */}
      {status === "done" ? (
        <Pressable onPress={onUndo} accessibilityRole="button" accessibilityLabel="Undo organisation"
          style={{alignSelf: "flex-start", height: 36, paddingHorizontal: s[4], borderRadius: 18, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: edge}}>
          <Text style={{fontFamily: hanken.semibold, fontSize: 14, color: c.ink}}>Undo</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export function OrgCard({proposal, status, report, color, box, edge, disabled, onConfirm, onCancel, onUndo}: {
  proposal: OrgProposal;
  status: OrgCardStatus;
  report?: OrgReport;
  color: string;
  box: string;
  edge: string;
  disabled?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  onUndo: () => void;
}) {
  if (status === "done" || status === "undone") {
    if (!report) return null;
    return <ReportCard report={report} status={status} edge={edge} box={box} onUndo={onUndo} />;
  }
  return <PreviewCard preview={proposal.preview} status={status} color={color} box={box} edge={edge} disabled={disabled} onConfirm={onConfirm} onCancel={onCancel} />;
}
