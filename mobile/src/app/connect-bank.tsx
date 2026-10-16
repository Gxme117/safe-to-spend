import {router, useLocalSearchParams} from "expo-router";
import * as Linking from "expo-linking";
import {useEffect, useRef, useState} from "react";
import {AppState, View} from "react-native";
import {PotRoles, syncMessage} from "@/components/Bank";
import {TextLink} from "@/components/Setup";
import {Form} from "@/components/Form";
import {Field, Input, T} from "@/components/ui";
import {authUrl, parseRedirect, REDIRECT_URI} from "@/lib/monzo";
import {approvedYet, clientFromEnv, clientId, connect, fetchSetupBank, hasClient, loginState, MonzoFail, saveClient, startLogin} from "@/services/monzo";
import {useMoney} from "@/store/useMoney";
import {s} from "@/theme/tokens";

type Step = "client" | "paste" | "approve" | "pots";

/**
 * Connect your own Monzo account: your developer client, log in in Safari, paste the link back, approve in the Monzo app
 * (this screen notices by itself).
 * From setup (`?from=setup`, on the first question or just before the bills) it only reads the total (main account + all pots)
 * and what your payments say back to setup; the full sync runs once setup is done.
 */
export default function ConnectBank() {
  const fromSetup = useLocalSearchParams<{from?: string}>().from === "setup";
  const bank = useMoney(st => st.state?.bank);
  const [step, setStep] = useState<Step>("client");
  const [id, setId] = useState("");
  const [secret, setSecret] = useState("");
  const [saved, setSaved] = useState(false);   // a secret is already in the Keychain
  const [own, setOwn] = useState(false);       // typing your own client instead of the built-in one
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    hasClient().then(async has => { setSaved(has); if (has) setId(await clientId()); }).catch(() => {});
  }, []);
  const fail = (msg: string) => { setError(msg); setBusy(false); };

  const logIn = async () => {
    const typed = !clientFromEnv || own;
    if (typed && (!id.trim() || (!secret.trim() && !saved))) return setError("Paste your client ID and secret first");
    setBusy(true);
    try {
      if (typed) await saveClient(id, secret);
      const st = await startLogin();
      await Linking.openURL(authUrl(id.trim(), st));
      setStep("paste"); setError(""); setBusy(false);
    } catch { fail("Couldn't open Monzo. Try again."); }
  };

  const paste = async () => {
    const code = parseRedirect(link, await loginState());
    if (!code) return setError(!/[?&]code=/.test(link)
      ? "That address has no login code in it. Paste the address Safari ends on (https://localhost/monzo?code=…), not the link from Monzo's email"
      : "That's from an earlier login. Each login has its own link: use the newest email from Monzo, or go back and log in again");
    setBusy(true);
    try { await connect(code); setStep("approve"); setError(""); setBusy(false); }
    catch (e) {
      const k = e instanceof MonzoFail ? e.kind : "other";
      fail(k === "offline" || k === "bad-client" ? syncMessage(k) : "Monzo didn't accept that link. Each link works once and only for a few minutes: log in again and paste the new one.");
    }
  };

  const done = () => { router.back(); useMoney.getState().notify("Monzo connected. Your balance now comes from your bank", true); };

  const going = useRef(false);   // reading from Monzo after approval: once, whether you tapped or it noticed
  const watch = useRef(true);    // checking by itself; stops after a failed read, so it doesn't retry every few seconds
  const approved = async () => {
    if (going.current) return;
    going.current = true; setBusy(true);
    const stop = (msg: string) => { going.current = false; watch.current = false; fail(msg); };
    if (fromSetup) {
      try { const r = await fetchSetupBank(); useMoney.getState().setSetupBank(r.totalPence / 100, r.found); setBusy(false); router.back(); }
      catch (e) { stop(syncMessage(e instanceof MonzoFail ? e.kind : "other")); }
      return;
    }
    const r = await useMoney.getState().syncBank();
    if ("error" in r) return stop(syncMessage(r.error) + (__DEV__ && r.detail ? `\n(${r.detail})` : ""));
    setBusy(false); setError("");
    const pots = useMoney.getState().state?.bank?.pots.length;
    if (pots) setStep("pots"); else done();
  };

  // no need to say you've approved: check every few seconds, and as soon as you're back from the Monzo app
  useEffect(() => {
    if (step !== "approve") return;
    let live = true, checking = false;
    const check = async () => {
      if (checking || going.current || !watch.current) return;
      checking = true;
      const yes = await approvedYet().catch(() => false);
      checking = false;
      if (yes && live) approved();
    };
    const timer = setInterval(check, 3000);
    const sub = AppState.addEventListener("change", st => { if (st === "active") check(); });
    return () => { live = false; clearInterval(timer); sub.remove(); };
  }, [step]); // eslint-disable-line react-hooks/exhaustive-deps

  if (step === "client" && clientFromEnv && !own) return (
    <Form error={error} submit={busy ? "Opening Monzo…" : "Log in with Monzo"} onSubmit={busy ? () => {} : logIn}>
      <T muted>Your Monzo client is set up on this phone. Log in, and Monzo emails you a link to finish.</T>
      <TextLink label="Use your own Monzo client" onPress={() => { setOwn(true); setId(""); setSaved(false); setError(""); }} />
    </Form>
  );
  if (step === "client") return (
    <Form error={error} submit={busy ? "Opening Monzo…" : "Log in with Monzo"} onSubmit={busy ? () => {} : logIn}>
      <T muted>{`This connects your own Monzo account through a personal developer client. Once, at developers.monzo.com: create a confidential client and set its redirect URL to ${REDIRECT_URI}.`}</T>
      <Field label="Client ID">
        <Input value={id} onChangeText={v => { setId(v); setError(""); }} autoCapitalize="none" autoCorrect={false} placeholder="oauth2client_…" accessibilityLabel="Client ID" />
      </Field>
      <Field label="Client secret" hint={saved ? "Saved on this phone. Leave blank to keep it." : "Kept in this phone's Keychain. Never sent anywhere but Monzo."}>
        <Input value={secret} onChangeText={v => { setSecret(v); setError(""); }} autoCapitalize="none" autoCorrect={false} secureTextEntry accessibilityLabel="Client secret" />
      </Field>
    </Form>
  );
  if (step === "paste") return (
    <Form error={error} submit={busy ? "Connecting…" : "Connect"} onSubmit={busy ? () => {} : paste}>
      <T muted>{"Monzo emails you a login link. It has to open in Safari, where the login started: long-press the link in the email, copy it, and paste it into Safari's address bar (opened anywhere else, Monzo says the state doesn't match). Safari then ends on a page that says it can't connect. That's expected: copy the whole address from Safari and paste it here."}</T>
      <Field label="The address from Safari">
        <Input value={link} onChangeText={v => { setLink(v); setError(""); }} autoCapitalize="none" autoCorrect={false} placeholder="https://localhost/monzo?code=…" accessibilityLabel="The address from Safari" />
      </Field>
    </Form>
  );
  if (step === "approve") return (
    <Form error={error} submit={busy ? "Checking…" : "I've approved it"} onSubmit={busy ? () => {} : approved}>
      <T weight="bold" size="lg">One more step in the Monzo app</T>
      <T muted>Monzo asks you to allow access before it shares anything. Open the Monzo app and approve the request. This page carries on by itself once you have.</T>
    </Form>
  );
  return (
    <Form submit="Done" onSubmit={done}>
      <View style={{gap: s[2]}}>
        <T weight="bold" size="lg">Which pots are spending money?</T>
        <T muted>Only your main account and pots marked as spending money count towards today&apos;s number. Savings stay out.</T>
      </View>
      {bank ? <PotRoles bank={bank} /> : null}
    </Form>
  );
}
