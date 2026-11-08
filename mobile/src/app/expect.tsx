import {router, useLocalSearchParams} from "expo-router";
import {useState} from "react";
import {Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, View} from "react-native";
import {useSafeAreaInsets} from "react-native-safe-area-context";
import {Calendar} from "@/components/Calendar";
import {TimeField} from "@/components/DateField";
import {Icon} from "@/components/Icon";
import {Button, Field, Input, T} from "@/components/ui";
import {addDays, niceDate, niceTime} from "@/lib/dates";
import {uid} from "@/lib/defaults";
import {moneyInDays} from "@/lib/calc";
import {buildIncome} from "@/lib/income";
import {money, parseAmount} from "@/lib/money";
import {useMoney} from "@/store/useMoney";
import {font, radius, s, textSize} from "@/theme/tokens";
import {useTheme} from "@/theme/useTheme";

/**
 * Money coming in, as a pop-up over the page, in two square-ish steps: the day on a calendar,
 * then roughly what time, how much and who from. It skips to the second when the day is already known.
 * Saved as money that comes just once. It isn't counted until it lands: after that time on the day,
 * the Day tab asks whether it arrived (unless the bank has already matched it).
 */
export default function ExpectMoney() {
  const {c} = useTheme();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{id?: string; date?: string}>();
  const st = useMoney.getState(), t = st.today;
  const old = params.id ? st.state?.incomes.find(x => x.id === params.id && x.freq === "oneoff") : undefined;
  const [date, setDate] = useState(old?.date ?? (params.date && params.date >= t ? params.date : t));
  const [time, setTime] = useState(old?.time ?? "09:00");
  const [amt, setAmt] = useState(old?.amount ? String(old.amount) : "");
  const [from, setFrom] = useState(old?.name ?? "");
  const [error, setError] = useState("");
  // the calendar first, unless the day is already known: editing, or opened from a day still to come
  const [step, setStep] = useState<"day" | "details">(old || (params.date && params.date > t) ? "details" : "day");
  const when = date === t ? "today" : date === addDays(t, 1) ? "tomorrow" : `on ${niceDate(date)}`;
  const bank = st.state?.bank?.source;
  // days with other money already on its way, paydays included: a dot on the calendar
  const [marks] = useState(() => st.state ? moneyInDays({state: st.state, txs: st.txs, today: t}, addDays(t, 90), old?.id) : new Set<string>());
  // opened straight from a link (or left open over a reload), there's nothing behind it: go to the Day tab instead
  const close = () => router.canGoBack() ? router.back() : router.replace("/");

  const save = () => {
    const a = parseAmount(amt);
    if (!(a > 0)) return setError("Enter how much is coming, e.g. 40");
    const name = from.trim();
    if (!name) return setError("Say who it's from, e.g. Nando's");
    const r = buildIncome({name, type: old?.type ?? "other", freq: "oneoff", date, varies: false, amount: a, low: NaN, typical: NaN, main: false},
      old, old?.id ?? "i" + uid(), t);
    if ("error" in r) return setError(r.error);
    useMoney.getState().saveIncome({...r.src, time});
    close();
    useMoney.getState().notify(`${money(a)} from ${r.src.name} expected ${when}. It counts once it lands`, true);
  };
  const remove = () => Alert.alert("Remove this money?", "It's no longer expected, and you won't be asked about it.", [
    {text: "Cancel", style: "cancel"},
    {text: "Remove", style: "destructive", onPress: () => { useMoney.getState().removeIncome(old!.id); close(); useMoney.getState().notify("Removed"); }},
  ]);

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={[styles.fill, {paddingTop: insets.top + s[4], paddingBottom: insets.bottom + s[4]}]}>
      {/* tap outside the card to close it */}
      <Pressable style={[StyleSheet.absoluteFill, {backgroundColor: "rgba(0,0,0,0.45)"}]} onPress={close} accessibilityRole="button" accessibilityLabel="Close" />
      <View style={[styles.card, {backgroundColor: c.bg}]} accessibilityViewIsModal>
        <View style={{flexDirection: "row", alignItems: "center", paddingHorizontal: s[5], paddingTop: s[4]}}>
          <View style={{flex: 1}} accessible accessibilityRole="header"><T style={{fontFamily: font.headBold, fontSize: textSize.lg}}>Money coming in</T></View>
          <Pressable onPress={close} hitSlop={s[2]} accessibilityRole="button" accessibilityLabel="Close"
            style={{width: 32, height: 32, borderRadius: radius.pill, backgroundColor: c.surface, alignItems: "center", justifyContent: "center"}}>
            <Icon name="close" color={c.ink} size={16} />
          </Pressable>
        </View>
        {step === "day" ? (
          <View style={{paddingHorizontal: s[4], paddingTop: s[2], paddingBottom: s[5], gap: s[3]}}>
            {/* tapping a day picks it (a bubble in the accent: money coming in); Next moves on */}
            <Calendar value={date} onChange={d => { setDate(d); setError(""); }} today={t} min={t} max={addDays(t, 90)} marks={marks} />
            <View style={{flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: s[1]}}>
              <Pressable onPress={() => router.replace("/add-payment?kind=income")} accessibilityRole="link" hitSlop={8}>
                <T size="sm" weight="semibold" style={{textDecorationLine: "underline"}}>Already arrived?</T>
              </Pressable>
              <Button small label="Next" onPress={() => setStep("details")} />
            </View>
          </View>
        ) : (
          <>
            <ScrollView contentContainerStyle={{paddingHorizontal: s[5], paddingVertical: s[4], gap: s[4]}} keyboardShouldPersistTaps="handled">
              <View style={{flexDirection: "row", alignItems: "center", gap: s[2]}}>
                {/* the day: tap to go back to the calendar */}
                <Pressable onPress={() => setStep("day")} accessibilityRole="button" accessibilityLabel={`${niceDate(date)}. Change the day`}
                  style={{flexDirection: "row", alignItems: "center", gap: s[1], backgroundColor: c.surface, borderRadius: radius.pill, paddingVertical: s[2], paddingLeft: s[3], paddingRight: s[2]}}>
                  <Icon name="month" color={c.ink} size={16} />
                  <T weight="semibold">{date === t ? "Today" : date === addDays(t, 1) ? "Tomorrow" : niceDate(date)}</T>
                  <Icon name="forward" color={c.ink} size={14} />
                </Pressable>
                <T muted>around</T>
                <TimeField label="Time it's coming" value={time} onChange={setTime} />
              </View>
              <Field label="How much?">
                <Input prefix="£" value={amt} onChangeText={v => { setAmt(v); setError(""); }} keyboardType="decimal-pad" placeholder="0.00" accessibilityLabel="Amount" />
              </Field>
              <Field label="Who's it from?">
                <Input value={from} onChangeText={v => { setFrom(v); setError(""); }} placeholder="e.g. Nando's" maxLength={40} accessibilityLabel="Who it's from" />
              </Field>
              <T muted size="sm" lines={1} fit>
                {bank ? `If ${bank} hasn't seen it by ${niceTime(time)}, we'll ask` : `After ${niceTime(time)} ${when}, we'll ask if it's arrived`}
              </T>
            </ScrollView>
            <View style={{paddingHorizontal: s[5], paddingBottom: s[5], gap: s[3]}}>
              {error ? <View accessibilityLiveRegion="assertive"><T weight="semibold" size="sm">{error}</T></View> : null}
              <View style={{flexDirection: "row", gap: s[3]}}>
                {old ? <Button kind="ghost" label="Remove" onPress={remove} /> : null}
                <View style={{flex: 1}}><Button label={old ? "Save" : "Add money coming in"} onPress={save} /></View>
              </View>
            </View>
          </>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  fill: {flex: 1, justifyContent: "center", paddingHorizontal: s[4]},
  card: {borderRadius: radius.card, borderCurve: "continuous", maxHeight: "100%", overflow: "hidden", boxShadow: "0 12px 32px rgba(0,0,0,0.25)"},
});
