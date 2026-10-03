import type {ReactNode} from "react";
import {KeyboardAvoidingView, Platform, ScrollView, View} from "react-native";
import {useSafeAreaInsets} from "react-native-safe-area-context";
import {s} from "@/theme/tokens";
import {useTheme} from "@/theme/useTheme";
import {Button, Chip, T} from "./ui";

/**
 * A modal form: scrolls clear of the keyboard, shows one plain error inline
 * (a toast would sit behind the native modal), and keeps the main button at the bottom.
 */
export function Form({children, error, submit, onSubmit, onRemove, removeLabel = "Remove"}: {
  children: ReactNode; error?: string; submit: string; onSubmit: () => void; onRemove?: () => void; removeLabel?: string;
}) {
  const {c} = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <KeyboardAvoidingView style={{flex: 1, backgroundColor: c.bg}} behavior={Platform.OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={Platform.OS === "ios" ? 56 : 0}>
      <ScrollView contentContainerStyle={{padding: s[4], gap: s[5], paddingBottom: s[6]}} keyboardShouldPersistTaps="handled">
        {children}
      </ScrollView>
      <View style={{paddingHorizontal: s[4], paddingTop: s[3], paddingBottom: Math.max(insets.bottom, s[4]), gap: s[3], borderTopWidth: 1, borderTopColor: c.line}}>
        {error ? <View accessibilityLiveRegion="assertive"><T weight="semibold" size={14}>{error}</T></View> : null}
        <View style={{flexDirection: "row", gap: s[3]}}>
          {onRemove ? <Button kind="ghost" label={removeLabel} onPress={onRemove} /> : null}
          <View style={{flex: 1}}><Button label={submit} onPress={onSubmit} /></View>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

/** A row of chips for picking one option. */
export function Choice<K extends string | number>({options, value, onChange}: {options: {key: K; label: string}[]; value: K | null; onChange: (k: K) => void}) {
  return (
    <View style={{flexDirection: "row", flexWrap: "wrap", gap: s[2]}} accessibilityRole="radiogroup">
      {options.map(o => <Chip key={String(o.key)} label={o.label} on={o.key === value} onPress={() => onChange(o.key)} />)}
    </View>
  );
}
