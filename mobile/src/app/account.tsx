import {router} from "expo-router";
import {useState} from "react";
import {Alert, ScrollView} from "react-native";
import {Button, Card, CardHead, Field, Input, T} from "@/components/ui";
import {useMoney} from "@/store/useMoney";
import {s} from "@/theme/tokens";

export default function AccountScreen() {
  const saved = useMoney(st => st.state?.name ?? "");
  const [name, setName] = useState(saved);

  const saveName = () => {
    useMoney.getState().setName(name);
    router.back();
    useMoney.getState().notify(name.trim() ? `Saved. Hi, ${name.trim()}` : "Name removed");
  };

  const startAgain = () => Alert.alert("Start again?", "This clears your balance, income, bills and payments, and takes you back to setup.", [
    {text: "Cancel", style: "cancel"},
    {text: "Start again", style: "destructive", onPress: () => {
      router.dismissAll();
      useMoney.getState().reset().catch(() => useMoney.getState().notify("That didn't clear. Try again."));
    }},
  ]);

  return (
    <ScrollView contentContainerStyle={{padding: s[4], gap: s[4], paddingBottom: s[7]}} keyboardShouldPersistTaps="handled">
      <Card>
        <CardHead title="You" />
        <Field label="Your name" hint="Optional. It shows on the account button.">
          <Input value={name} onChangeText={setName} autoCapitalize="words" autoComplete="given-name" returnKeyType="done"
            onSubmitEditing={saveName} accessibilityLabel="Your name" />
        </Field>
        <Button label="Save" onPress={saveName} disabled={name.trim() === saved} />
      </Card>

      <Card>
        <CardHead title="Your data" />
        <T muted>Everything is stored on this phone. Nothing is sent anywhere.</T>
        <Button kind="ghost" label="Start again" onPress={startAgain} />
      </Card>
    </ScrollView>
  );
}
