import {router} from "expo-router";
import {useEffect, useState} from "react";
import {AppState, Animated, Easing, Pressable, View} from "react-native";
import {money} from "@/lib/money";
import type {Bank} from "@/lib/types";
import {type SyncError, useMoney} from "@/store/useMoney";
import {radius, s} from "@/theme/tokens";
import {useTheme} from "@/theme/useTheme";
import {useReducedMotion} from "./BigMoney";
import {Icon} from "./Icon";
import {Chip, T} from "./ui";

const SAY: Record<SyncError, string> = {
  "needs-approval": "Approve the request in your Monzo app, then sync again",
  "needs-login": "Monzo needs you to log in again",
  "bad-client": "Monzo didn't recognise your client ID or secret. Check them against developers.monzo.com",
  offline: "Couldn't reach Monzo. Check your connection and try again",
  other: "Monzo didn't answer properly. Try again in a minute",
  "not-saved": "Your payments from Monzo didn't save. Try again",
};
export const syncMessage = (e: SyncError) => SAY[e];
const updated = (n: number) => n ? `Updated from Monzo. ${n} new payment${n > 1 ? "s" : ""} added` : "Updated from Monzo. No new payments";

/** Sync every connected bank (Monzo is the only one so far) and say how it went.
 *  Quiet syncs (on opening the app) only speak up when the bank needs something from you. */
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

/** One round button for every connected bank: syncs them all, or opens Connect when there are none yet.
 *  Icon only; the arrows turn while it works (they stay still with Reduce Motion on). */
export function SyncButton() {
  const {c} = useTheme();
  const connected = useMoney(st => !!st.state?.bank);
  const syncing = useMoney(st => st.syncing);
  const reduced = useReducedMotion();
  const [spin] = useState(() => new Animated.Value(0));
  useEffect(() => {
    if (!syncing || reduced) { spin.stopAnimation(); spin.setValue(0); return; }
    const loop = Animated.loop(Animated.timing(spin, {toValue: 1, duration: 800, easing: Easing.linear, useNativeDriver: true}));
    loop.start();
    return () => loop.stop();
  }, [syncing, reduced, spin]);
  return (
    <Pressable onPress={() => connected ? syncNow() : router.push("/connect-bank")} disabled={syncing} hitSlop={4}
      accessibilityRole="button" accessibilityLabel={connected ? (syncing ? "Syncing your banks" : "Sync your banks") : "Connect a bank"} accessibilityState={{busy: syncing}}
      style={{width: 36, height: 36, borderRadius: radius.pill, backgroundColor: c.surface, alignItems: "center", justifyContent: "center"}}>
      <Animated.View style={{transform: [{rotate: spin.interpolate({inputRange: [0, 1], outputRange: ["0deg", "360deg"]})}]}}>
        <Icon name="refresh" color={c.ink} size={20} />
      </Animated.View>
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
