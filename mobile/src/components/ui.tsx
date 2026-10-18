import type {ReactNode} from "react";
import {Pressable, StyleSheet, Text, TextInput, View, type StyleProp, type TextInputProps, type TextStyle, type ViewStyle} from "react-native";
import {font, radius, s, textSize, type TextSize} from "@/theme/tokens";
import {useTheme} from "@/theme/useTheme";

/** Text in Manrope (Hanken Grotesk on Today), coloured for the current theme. */
export function T({children, style, muted, weight = "regular", size = "md", lines, fit}: {
  children: ReactNode; style?: StyleProp<TextStyle>; muted?: boolean; weight?: keyof typeof font; size?: TextSize; lines?: number; fit?: boolean;
}) {
  const {c, f} = useTheme();
  const px = textSize[size];
  return (
    <Text numberOfLines={lines} adjustsFontSizeToFit={fit} minimumFontScale={fit ? 0.75 : undefined}
      style={[{fontFamily: f[weight], fontSize: px, color: muted ? c.muted : c.ink, lineHeight: Math.round(px * 1.4)}, style]}>
      {children}
    </Text>
  );
}

/** The big title at the top of a page. Long dates ("Wednesday 30 September") shrink to fit narrow phones rather than get cut off. */
export function PageTitle({children}: {children: string}) {
  const {c} = useTheme();
  return (
    <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75} accessibilityRole="header"
      style={{fontFamily: font.head, fontSize: textSize.xl, lineHeight: Math.round(textSize.xl * 1.2), color: c.ink}}>
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
      <T weight="bold" size="lg" style={{flex: 1}}>{title}</T>
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
      <Text style={{fontFamily: font.bold, fontSize: textSize[small ? "sm" : "md"], color: fg}}>{label}</Text>
    </Pressable>
  );
}

export function Chip({label, on, onPress, accessibilityLabel}: {label: string; on?: boolean; onPress: () => void; accessibilityLabel?: string}) {
  const {c} = useTheme();
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityState={{selected: !!on}} accessibilityLabel={accessibilityLabel ?? label}
      style={({pressed}) => [styles.chip, {backgroundColor: on ? c.ink : "transparent", borderColor: on ? c.ink : c.line, opacity: pressed ? 0.7 : 1}]}>
      <Text style={{fontFamily: font.semibold, fontSize: textSize.sm, color: on ? c.bg : c.ink}}>{label}</Text>
    </Pressable>
  );
}

export function Field({label, hint, children}: {label: string; hint?: string; children: ReactNode}) {
  return (
    <View style={{gap: s[2]}}>
      <T weight="semibold" size="sm">{label}</T>
      {children}
      {hint ? <T muted size="sm">{hint}</T> : null}
    </View>
  );
}

export function Input(props: TextInputProps & {prefix?: string; suffix?: string; box?: StyleProp<ViewStyle>}) {
  const {c} = useTheme();
  const {prefix, suffix, style, box, ...rest} = props;
  return (
    <View style={[styles.input, {borderColor: c.line, backgroundColor: c.bg}, box]}>
      {/* the prefix matches the placeholder, so a page that brightens one brightens both */}
      {prefix ? <Text style={{fontFamily: font.bold, fontSize: textSize.md, color: rest.placeholderTextColor ?? c.muted}}>{prefix}</Text> : null}
      <TextInput placeholderTextColor={c.muted} {...rest}
        style={[{flex: 1, fontFamily: font.semibold, fontSize: textSize.md, color: c.ink, paddingVertical: s[3]}, style]} />
      {/* the suffix is in the text's colour, at the end of the box */}
      {suffix ? <Text style={{fontFamily: font.heavy, fontSize: textSize.md, color: StyleSheet.flatten(style)?.color ?? c.ink}}>{suffix}</Text> : null}
    </View>
  );
}

/** A list row: name and a one-line meta on the left, an amount on the right. `good`: money coming in, in the bright green. */
export function Row({name, meta, amount, good, leading, onPress, onLongPress, accessibilityHint, selected}: {
  name: string; leading?: ReactNode; meta?: string; amount?: string; good?: boolean; onPress?: () => void; onLongPress?: () => void; accessibilityHint?: string;
  selected?: boolean;   // a row in a list you tick
}) {
  const {c} = useTheme();
  const body = (
    <View style={styles.row}>
      {leading}
      <View style={{flex: 1, gap: 2}}>
        <T weight="semibold" lines={1}>{name}</T>
        {meta ? <T muted size="sm" lines={1}>{meta}</T> : null}
      </View>
      {amount ? <T weight={good ? "heavy" : "bold"} style={[{fontVariant: ["tabular-nums"]}, good && {color: c.incoming}]}>{amount}</T> : null}
    </View>
  );
  if (!onPress && !onLongPress) return <View accessible={selected !== undefined} accessibilityState={selected !== undefined ? {selected} : undefined} style={[styles.rowWrap, {borderTopColor: c.line}]}>{body}</View>;
  return (
    <Pressable onPress={onPress} onLongPress={onLongPress} accessibilityRole="button" accessibilityHint={accessibilityHint} accessibilityState={selected !== undefined ? {selected} : undefined}
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
