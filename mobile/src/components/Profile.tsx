import {router} from "expo-router";
import {useState} from "react";
import {Alert} from "react-native";
import {PotRoles} from "@/components/Bank";
import {Button, Card, CardHead, Field, Input, T} from "@/components/ui";
import {isoD, niceDate, pad} from "@/lib/dates";
import {useMoney} from "@/store/useMoney";

const when = (iso: string) => { const d = new Date(iso); return `${niceDate(isoD(d))} at ${pad(d.getHours())}:${pad(d.getMinutes())}`; };

/** Your name. */
export function YouCard() {
  const saved = useMoney(st => st.state?.name ?? "");
  const [name, setName] = useState(saved);
  const saveName = () => {
    useMoney.getState().setName(name);
    useMoney.getState().notify(name.trim() ? `Saved. Hi, ${name.trim()}` : "Name removed");
  };
  return (
    <Card>
      <CardHead title="You" />
      <Field label="Your name" hint="Optional.">
        <Input value={name} onChangeText={setName} autoCapitalize="words" autoComplete="given-name" returnKeyType="done"
          onSubmitEditing={saveName} accessibilityLabel="Your name" />
      </Field>
      <Button label="Save" onPress={saveName} disabled={name.trim() === saved} />
    </Card>
  );
}

/** Monzo: connect, set pot roles, disconnect. */
export function BankSettings() {
  const bank = useMoney(st => st.state?.bank);
  const disconnect = () => Alert.alert("Disconnect Monzo?", "Your balance stays as it is now, and you type it in yourself from here. Your client ID and secret are removed from this phone.", [
    {text: "Cancel", style: "cancel"},
    {text: "Disconnect", style: "destructive", onPress: () => {
      useMoney.getState().disconnectBank().then(() => useMoney.getState().notify("Monzo disconnected"), () => useMoney.getState().notify("That didn't disconnect. Try again."));
    }},
  ]);
  return (
    <Card>
      <CardHead title="Bank" />
      {bank ? (
        <>
          <T muted>Connected to Monzo. Last updated {when(bank.asOf)}.</T>
          <PotRoles bank={bank} />
          <Button kind="ghost" label="Disconnect Monzo" onPress={disconnect} />
        </>
      ) : (
        <>
          <T muted>Connect your Monzo account and your balance and pots update themselves. You still log payments here.</T>
          <Button label="Connect Monzo" onPress={() => router.push("/connect-bank")} />
        </>
      )}
    </Card>
  );
}

/** Where your data lives, and starting over. */
export function DataCard() {
  const bank = useMoney(st => !!st.state?.bank);
  const startAgain = () => Alert.alert("Start again?", "This clears your balance, income, bills and payments, and takes you back to setup.", [
    {text: "Cancel", style: "cancel"},
    {text: "Start again", style: "destructive", onPress: () => {
      if (router.canDismiss()) router.dismissAll();
      useMoney.getState().reset().catch(() => useMoney.getState().notify("That didn't clear. Try again."));
    }},
  ]);
  return (
    <Card>
      <CardHead title="Your data" />
      <T muted>{bank ? "Everything is stored on this phone. The app only talks to Monzo, to read your balance and pots." : "Everything is stored on this phone. Nothing is sent anywhere."}</T>
      <Button kind="ghost" label="Start again" onPress={startAgain} />
    </Card>
  );
}
