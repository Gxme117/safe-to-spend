import {router} from "expo-router";
import {useState} from "react";
import {Alert, Pressable, Switch, View} from "react-native";
import {PotRoles} from "@/components/Bank";
import {Icon} from "@/components/Icon";
import {Button, Card, CardHead, Field, Input, T} from "@/components/ui";
import type {Note} from "@/lib/ai/tools";
import {isoD, niceDate, pad, shortDate} from "@/lib/dates";
import {money} from "@/lib/money";
import type {Bank} from "@/lib/types";
import {useMoney} from "@/store/useMoney";
import {s} from "@/theme/tokens";
import {useTheme} from "@/theme/useTheme";

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

/** Monzo and banks linked through Open Banking: connect, set pot roles, disconnect. */
export function BankSettings() {
  const bank = useMoney(st => st.state?.bank);
  const links = useMoney(st => st.state?.links) || [];
  const remove = (b: Bank) => Alert.alert(`Remove ${b.source}?`, "Its money stops counting towards today's number, and its login is removed from this phone. Its payments stay.", [
    {text: "Cancel", style: "cancel"},
    {text: "Remove", style: "destructive", onPress: () => {
      useMoney.getState().removeLink(b.accountId).then(() => useMoney.getState().notify(`${b.source} removed`), () => useMoney.getState().notify("That didn't remove. Try again."));
    }},
  ]);
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
      {links.map(b => (
        <View key={b.accountId} style={{gap: s[4]}}>
          <T muted>Connected to {b.source}. Last updated {when(b.asOf)}.</T>
          <PotRoles bank={b} />
          <Button kind="ghost" label={`Remove ${b.source}`} onPress={() => remove(b)} />
        </View>
      ))}
      <Button kind="ghost" label="Add an account" onPress={() => router.push("/link-bank")} />
    </Card>
  );
}

/** Where your data lives, and starting over. */
const KIND: Record<Note["kind"], string> = {goal: "Goal", plan: "Plan", preference: "Preference", circumstance: "About you"};
const noteMeta = (n: Note) => [KIND[n.kind], n.amount != null ? money(n.amount) : "", n.by ? `by ${shortDate(n.by)}` : "",
  `noted by ${n.who === "tim" ? "Tim" : "Frank"}, ${shortDate(n.at)}`].filter(Boolean).join(" · ");

/** Tim and Frank: whether they can look at your numbers, whether Frank reads his answers out, and everything they've noted about you, each one deletable. */
export function AccountantCard() {
  const {c} = useTheme();
  const consent = useMoney(st => st.aiConsent), notes = useMoney(st => st.notes), speaks = useMoney(st => st.speaks);
  const forget = (n: Note) => {
    const gone = useMoney.getState().removeNote(n.id);
    if (gone) useMoney.getState().notify("Forgotten", false, () => useMoney.getState().restoreNote(gone.note, gone.at));
  };
  const forgetAll = () => Alert.alert("Forget everything?", "Tim and Frank won't remember anything you've told them.", [
    {text: "Cancel", style: "cancel"},
    {text: "Forget everything", style: "destructive", onPress: () => useMoney.getState().forgetAll()},
  ]);
  return (
    <Card>
      <CardHead title="Tim and Frank" />
      <View style={{flexDirection: "row", alignItems: "center", gap: s[3]}}>
        <T style={{flex: 1}}>Let them look at your numbers</T>
        <Switch value={consent} onValueChange={v => useMoney.getState().setAiConsent(v)} trackColor={{true: c.ink, false: c.line}} accessibilityLabel="Let Tim and Frank look at your numbers" />
      </View>
      <T muted>{consent
        ? "When you ask them something, the figures it needs go to Anthropic, whose AI they run on, through Pinch's server, which keeps none of it. Never your account numbers or logins."
        : "They'll ask first, the next time you ask them something."}</T>
      <View style={{flexDirection: "row", alignItems: "center", gap: s[3]}}>
        <T style={{flex: 1}}>They read their answers out</T>
        <Switch value={speaks} onValueChange={v => useMoney.getState().setSpeaks(v)} trackColor={{true: c.ink, false: c.line}} accessibilityLabel="Tim and Frank read their answers out" />
      </View>
      <T muted>{speaks
        ? "One short line of each answer, in their own voices. That line goes to ElevenLabs, who make their voices, and nothing else does."
        : "Their answers are only written down."}</T>
      <T weight="semibold">What they remember</T>
      {notes.length ? notes.map(n => (
        <View key={n.id} style={{flexDirection: "row", alignItems: "center", gap: s[2]}}>
          <View style={{flex: 1}}>
            <T>{n.text}</T>
            <T muted size="sm">{noteMeta(n)}</T>
          </View>
          <Pressable onPress={() => forget(n)} accessibilityRole="button" accessibilityLabel={`Forget: ${n.text}`} hitSlop={8}
            style={({pressed}) => ({width: 44, height: 44, alignItems: "center", justifyContent: "center", opacity: pressed ? 0.6 : 1})}>
            <Icon name="close" color={c.muted} size={16} />
          </Pressable>
        </View>
      )) : <T muted>Nothing yet. When you tell them something that will matter later, like a goal you&apos;re saving for, it shows here.</T>}
      {notes.length ? <Button kind="ghost" label="Forget everything" onPress={forgetAll} /> : null}
    </Card>
  );
}

export function DataCard() {
  const bank = useMoney(st => !!st.state?.bank), ai = useMoney(st => st.aiConsent);
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
      <T muted>{(bank ? "Everything is stored on this phone. The app only talks to Monzo, to read your balance and pots." : "Everything is stored on this phone. Nothing is sent anywhere.")
        + (ai ? " When you ask Tim or Frank something, the figures it needs go to the AI that answers." : "")}</T>
      <Button kind="ghost" label="Start again" onPress={startAgain} />
    </Card>
  );
}
