import type {ReactNode} from "react";
import {KeyboardAvoidingView, Platform, Pressable, ScrollView, View} from "react-native";
import {useSafeAreaInsets} from "react-native-safe-area-context";
import {ord} from "@/lib/dates";
import {font, s} from "@/theme/tokens";
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
        {error ? <View accessibilityLiveRegion="assertive"><T weight="semibold" size="sm">{error}</T></View> : null}
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

/**
 * Chips for picking any number of options: tap to pick, tap again to unpick.
 * `children` sits at the end of the row (an "Add more" chip).
 */
export function Picks({options, value, onChange, children}: {options: string[]; value: string[]; onChange: (v: string[]) => void; children?: ReactNode}) {
  const toggle = (o: string) => onChange(value.includes(o) ? value.filter(x => x !== o) : [...value, o]);
  return (
    <View style={{flexDirection: "row", flexWrap: "wrap", gap: s[2]}}>
      {options.map(o => <Chip key={o} label={o} on={value.includes(o)} onPress={() => toggle(o)} />)}
      {children}
    </View>
  );
}

/** The days of the month, a week to a row, and the last working day. */
export function DayGrid({value, onChange}: {value: number | "last" | null; onChange: (d: number | "last") => void}) {
  const {c} = useTheme();
  return (
    <View style={{gap: s[2]}}>
      <View style={{flexDirection: "row", flexWrap: "wrap"}} accessibilityRole="radiogroup">
        {Array.from({length: 31}, (_, i) => i + 1).map(n => {
          const on = value === n;
          return (
            <View key={n} style={{width: `${100 / 7}%`, padding: 2}}>
              <Pressable onPress={() => onChange(n)} accessibilityRole="radio" accessibilityState={{checked: on}} accessibilityLabel={ord(n)}
                style={{height: 40, borderRadius: 10, borderCurve: "continuous", alignItems: "center", justifyContent: "center", backgroundColor: on ? c.ink : "transparent", borderWidth: 1, borderColor: on ? c.ink : c.line}}>
                <T weight="bold" size="sm" style={{color: on ? c.bg : c.ink, fontFamily: font.bold}}>{n}</T>
              </Pressable>
            </View>
          );
        })}
      </View>
      <View style={{flexDirection: "row"}}><Chip label="Last working day" on={value === "last"} onPress={() => onChange("last")} /></View>
    </View>
  );
}
