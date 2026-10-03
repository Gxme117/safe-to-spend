import {useState} from "react";
import {KeyboardAvoidingView, Platform, View} from "react-native";
import {SafeAreaView} from "react-native-safe-area-context";
import {Button, Field, Input, T} from "@/components/ui";
import {parseAmount} from "@/lib/money";
import {useMoney} from "@/store/useMoney";
import {s} from "@/theme/tokens";
import {useTheme} from "@/theme/useTheme";

/** First run: one question. Everything else is worked out from income and bills, added next. */
export default function SetupScreen() {
  const {c} = useTheme();
  const [bal, setBal] = useState("");
  const [error, setError] = useState("");
  const start = () => {
    const b = parseAmount(bal);
    if (Number.isNaN(b)) return setError("Enter your balance as a number, e.g. 1250.50");
    useMoney.getState().setup(b);   // the protected route then opens the app
  };
  return (
    <SafeAreaView style={{flex: 1, backgroundColor: c.bg}}>
      <KeyboardAvoidingView style={{flex: 1, justifyContent: "center", padding: s[5], gap: s[5]}} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={{gap: s[2]}}>
          <T weight="heavy" size={28}>What can I spend today?</T>
          <T muted>This works out how much is safe to spend each day until payday, after your bills.</T>
        </View>
        <Field label="How much is in your account right now?" hint="The balance your bank app shows. You can change it any time.">
          <Input prefix="£" value={bal} onChangeText={t => { setBal(t); setError(""); }} keyboardType="decimal-pad" placeholder="0.00"
            autoFocus returnKeyType="done" onSubmitEditing={start} accessibilityLabel="Your balance" />
        </Field>
        {error ? <T weight="semibold" size={14}>{error}</T> : null}
        <Button label="Start tracking" onPress={start} />
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
