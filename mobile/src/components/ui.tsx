import type {ReactNode} from "react";
import {Pressable, StyleSheet, Text, TextInput, View, type StyleProp, type TextInputProps, type TextStyle, type ViewStyle} from "react-native";
import {font, radius, s} from "@/theme/tokens";
import {useTheme} from "@/theme/useTheme";

/** Text in Manrope, coloured for the current theme. */
export function T({children, style, muted, weight = "regular", size = 16, lines, fit}: {
  children: ReactNode; style?: StyleProp<TextStyle>; muted?: boolean; weight?: keyof typeof font; size?: number; lines?: number; fit?: boolean;
}) {
  const {c} = useTheme();
  return (
    <Text numberOfLines={lines} adjustsFontSizeToFit={fit} minimumFontScale={fit ? 0.75 : undefined}
      style={[{fontFamily: font[weight], fontSize: size, color: muted ? c.muted : c.ink, lineHeight: Math.round(size * 1.4)}, style]}>
      {children}
    </Text>
  );
}

export function Card({children, style}: {children: ReactNode; style?: StyleProp<ViewStyle>}) {
  const {c} = useTheme();
  return <View style={[styles.card, {backgroundColor: c.surface}, style]}>{children}</View>;
}

export function CardHead({title, right}: {title: string; right?: ReactNode}) {
  return (
    <View style={styles.head}>
      <T weight="bold" size={18} style={{flex: 1}}>{title}</T>
      {right}
    </View>
  );
}

type Kind = "primary" | "ghost" | "good";
export function Button({label, onPress, kind = "primary", small, disabled, accessibilityLabel}: {
  label: string; onPress: () => void; kind?: Kind; small?: boolean; disabled?: boolean; accessibilityLabel?: string;
}) {
  const {c} = useTheme();
  // primary is ink-on-paper; only "good" (money arriving) uses the accent
  const bg = kind === "primary" ? c.ink : kind === "good" ? c.accent : "transparent";
  const fg = kind === "primary" ? c.bg : kind === "good" ? c.accentInk : c.ink;
  return (
    <Pressable onPress={onPress} disabled={disabled} accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{disabled}}
      style={({pressed}) => [styles.btn, small && styles.btnSmall, {backgroundColor: bg, borderColor: kind === "ghost" ? c.line : bg, opacity: disabled ? 0.4 : pressed ? 0.7 : 1}]}>
      <Text style={{fontFamily: font.bold, fontSize: small ? 14 : 16, color: fg}}>{label}</Text>
    </Pressable>
  );
}

export function Chip({label, on, onPress, accessibilityLabel}: {label: string; on?: boolean; onPress: () => void; accessibilityLabel?: string}) {
  const {c} = useTheme();
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityState={{selected: !!on}} accessibilityLabel={accessibilityLabel ?? label}
      style={({pressed}) => [styles.chip, {backgroundColor: on ? c.ink : "transparent", borderColor: on ? c.ink : c.line, opacity: pressed ? 0.7 : 1}]}>
      <Text style={{fontFamily: font.semibold, fontSize: 14, color: on ? c.bg : c.ink}}>{label}</Text>
    </Pressable>
  );
}

export function Field({label, hint, children}: {label: string; hint?: string; children: ReactNode}) {
  return (
    <View style={{gap: s[2]}}>
      <T weight="semibold" size={14}>{label}</T>
      {children}
      {hint ? <T muted size={13}>{hint}</T> : null}
    </View>
  );
}

export function Input(props: TextInputProps & {prefix?: string}) {
  const {c} = useTheme();
  const {prefix, style, ...rest} = props;
  return (
    <View style={[styles.input, {borderColor: c.line, backgroundColor: c.bg}]}>
      {prefix ? <Text style={{fontFamily: font.bold, fontSize: 17, color: c.muted}}>{prefix}</Text> : null}
      <TextInput placeholderTextColor={c.muted} {...rest}
        style={[{flex: 1, fontFamily: font.semibold, fontSize: 17, color: c.ink, paddingVertical: s[3]}, style]} />
    </View>
  );
}

/** A list row: name and a one-line meta on the left, an amount on the right. */
export function Row({name, meta, amount, good, onPress, onLongPress, accessibilityHint}: {
  name: string; meta?: string; amount?: string; good?: boolean; onPress?: () => void; onLongPress?: () => void; accessibilityHint?: string;
}) {
  const {c} = useTheme();
  const body = (
    <View style={styles.row}>
      <View style={{flex: 1, gap: 2}}>
        <T weight="semibold" lines={1}>{name}</T>
        {meta ? <T muted size={13} lines={1}>{meta}</T> : null}
      </View>
      {amount ? <T weight="bold" style={[{fontVariant: ["tabular-nums"]}, good && {color: c.good}]}>{amount}</T> : null}
    </View>
  );
  if (!onPress && !onLongPress) return <View style={[styles.rowWrap, {borderTopColor: c.line}]}>{body}</View>;
  return (
    <Pressable onPress={onPress} onLongPress={onLongPress} accessibilityRole="button" accessibilityHint={accessibilityHint}
      style={({pressed}) => [styles.rowWrap, {borderTopColor: c.line, opacity: pressed ? 0.6 : 1}]}>
      {body}
    </Pressable>
  );
}

export function Gap({size = 4}: {size?: keyof typeof s}) { return <View style={{height: s[size]}} />; }

const styles = StyleSheet.create({
  card: {borderRadius: radius.card, padding: s[5], gap: s[3]},
  head: {flexDirection: "row", alignItems: "center", gap: s[3]},
  btn: {borderRadius: radius.pill, borderWidth: 1, paddingVertical: s[3], paddingHorizontal: s[5], alignItems: "center", justifyContent: "center", minHeight: 48},
  btnSmall: {paddingVertical: s[2], paddingHorizontal: s[4], minHeight: 36},
  chip: {borderRadius: radius.pill, borderWidth: 1, paddingVertical: s[2], paddingHorizontal: s[4], minHeight: 36, justifyContent: "center"},
  input: {flexDirection: "row", alignItems: "center", gap: s[2], borderWidth: 1, borderRadius: radius.control, paddingHorizontal: s[4]},
  rowWrap: {borderTopWidth: StyleSheet.hairlineWidth},
  row: {flexDirection: "row", alignItems: "center", gap: s[3], paddingVertical: s[3]},
});
