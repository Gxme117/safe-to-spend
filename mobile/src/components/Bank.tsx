import {router} from "expo-router";
import {useEffect, useState} from "react";
import {AppState, Animated, Easing, Pressable, View} from "react-native";
import {money} from "@/lib/money";
import type {Bank} from "@/lib/types";
import {type SyncError, useMoney} from "@/store/useMoney";
import {radius, s} from "@/theme/tokens";
import {useReducedMotion} from "./BigMoney";
import {Icon} from "./Icon";
import {Chip, T} from "./ui";

const SAY: Record<SyncError, string> = {
  "needs-approval": "Approve the request in your Monzo app, then tap Sync again",
  "needs-login": "Monzo needs you to log in again",
  "bad-client": "Monzo didn't recognise your client ID or secret. Check them against developers.monzo.com",
  offline: "Couldn't reach Monzo. Check your connection and try again",
  other: "Monzo didn't answer properly. Try again in a minute",
  "not-saved": "Your payments from Monzo didn't save. Try again",
};
export const syncMessage = (e: SyncError) => SAY[e];
const updated = (n: number) => n ? `Updated from Monzo. ${n} new payment${n > 1 ? "s" : ""} added` : "Updated from Monzo. No new payments";

/** Sync and say how it went. Quiet syncs (on opening the app) only speak up when Monzo needs something from you. */
export async function syncNow(quiet = false) {
  const {syncBank, notify} = useMoney.getState();
  const r = await syncBank();
  if ("added" in r) { if (!quiet) notify(updated(r.added), true); return; }
  const e = r.error;
  if (quiet && e !== "needs-approval" && e !== "needs-login") return;
  notify(SAY[e] + (__DEV__ && r.detail ? ` (${r.detail})` : ""));
  if (e === "needs-login" && !quiet) router.push("/connect-bank");
}

const STALE = 15 * 60 * 1000;
/** Quietly sync when the app opens or comes back, if the last sync is over 15 minutes old. */
export function useAutoSync() {
  useEffect(() => {
    const maybe = () => {
      const b = useMoney.getState().state?.bank;
      if (b && Date.now() - Date.parse(b.asOf) > STALE) syncNow(true);
    };
    maybe();
    const sub = AppState.addEventListener("change", st => { if (st === "active") maybe(); });
    return () => sub.remove();
  }, []);
}

/** Sync when connected, connect when not. The arrows turn while it works (they stay still with Reduce Motion on). */
export function SyncButton({bank, ink}: {bank?: Bank; ink: string}) {
  const syncing = useMoney(st => st.syncing);
  const reduced = useReducedMotion();
  const [spin] = useState(() => new Animated.Value(0));
  useEffect(() => {
    if (!syncing || reduced) { spin.stopAnimation(); spin.setValue(0); return; }
    const loop = Animated.loop(Animated.timing(spin, {toValue: 1, duration: 800, easing: Easing.linear, useNativeDriver: true}));
    loop.start();
    return () => loop.stop();
  }, [syncing, reduced, spin]);
  const label = bank ? (syncing ? "Syncing" : "Sync") : "Connect";
  return (
    <Pressable onPress={() => bank ? syncNow() : router.push("/connect-bank")} disabled={syncing} hitSlop={s[2]}
      accessibilityRole="button" accessibilityLabel={bank ? "Sync with Monzo" : "Connect Monzo"} accessibilityState={{busy: syncing}}
      style={{flexDirection: "row", alignItems: "center", gap: 6, borderWidth: 1, borderColor: ink, borderRadius: radius.pill, paddingVertical: s[1], paddingHorizontal: s[3]}}>
      <Animated.View style={{transform: [{rotate: spin.interpolate({inputRange: [0, 1], outputRange: ["0deg", "360deg"]})}]}}>
        <Icon name="refresh" color={ink} size={16} />
      </Animated.View>
      <T size="sm" weight="bold" style={{color: ink}}>{label}</T>
    </Pressable>
  );
}

/** Which pots are spending money. Savings and business pots never count towards today's number. */
export function PotRoles({bank}: {bank: Bank}) {
  if (!bank.pots.length) return <T muted>No pots in your Monzo account.</T>;
  return (
    <View style={{gap: s[4]}}>
      {bank.pots.map(p => (
        <View key={p.id} style={{gap: s[2]}}>
          <View style={{flexDirection: "row", justifyContent: "space-between", gap: s[3]}}>
            <T weight="semibold" lines={1} style={{flex: 1}}>{p.name}</T>
            <T weight="bold" style={{fontVariant: ["tabular-nums"]}}>{money(p.balance)}</T>
          </View>
          <View style={{flexDirection: "row", gap: s[2]}} accessibilityRole="radiogroup" accessibilityLabel={`${p.name} pot`}>
            <Chip label="Spending money" on={p.role === "spend"} onPress={() => useMoney.getState().setPotRole(p.id, "spend")} />
            <Chip label="Set aside" on={p.role === "save"} onPress={() => useMoney.getState().setPotRole(p.id, "save")} />
          </View>
        </View>
      ))}
    </View>
  );
}
