import {router} from "expo-router";
import {useState} from "react";
import {View} from "react-native";
import {PotRoles, syncMessage} from "@/components/Bank";
import {Form} from "@/components/Form";
import {TextLink} from "@/components/Setup";
import {T} from "@/components/ui";
import {useMoney} from "@/store/useMoney";
import {s} from "@/theme/tokens";

/**
 * Add a bank through Open Banking (TrueLayer; the sandbox's Mock bank for now): pick it and approve on the bank's own page,
 * in a sheet that closes by itself, then say which of its accounts are spending money.
 */
export default function LinkBank() {
  const monzo = useMoney(st => !!st.state?.bank);
  const [id, setId] = useState<string | null>(null);
  const bank = useMoney(st => st.state?.links?.find(b => b.accountId === id));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const choose = async () => {
    setBusy(true); setError("");
    const r = await useMoney.getState().addLink();
    setBusy(false);
    if (!r) return;
    if ("error" in r) return setError(syncMessage(r.error, r.bank) + (__DEV__ && r.detail ? `\n(${r.detail})` : ""));
    setId(r.id);
  };
  const done = () => { router.back(); if (bank) useMoney.getState().notify(`${bank.source} connected`, true); };

  if (bank) return (
    <Form submit="Done" onSubmit={done}>
      <View style={{gap: s[2]}}>
        <T weight="bold" size="lg">Which accounts are spending money?</T>
        <T muted>{`Only ${bank.source}'s main account and the accounts marked as spending money count towards today's number. Savings stay out.`}</T>
      </View>
      <PotRoles bank={bank} />
    </Form>
  );
  return (
    <Form error={error} submit={busy ? "Connecting…" : "Choose your bank"} onSubmit={busy ? () => {} : choose}>
      <T muted>Connect your bank through Open Banking. You log in on your bank&apos;s own page, and Pinch only reads your balances and payments.</T>
      {monzo ? null : <TextLink label="Connect Monzo instead" onPress={() => router.replace("/connect-bank")} />}
    </Form>
  );
}
