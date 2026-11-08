import DateTimePicker, {DateTimePickerAndroid} from "@react-native-community/datetimepicker";
import {Platform, Pressable, View} from "react-native";
import {isoD, niceDate, niceTime, nowHM, parseD} from "@/lib/dates";
import type {IsoDate} from "@/lib/types";
import {radius, s} from "@/theme/tokens";
import {useTheme} from "@/theme/useTheme";
import {T} from "./ui";

/** A time picker that reads and writes "14:00". iOS shows the compact picker; Android opens its dialog. */
export function TimeField({value, onChange, label}: {value: string; onChange: (hm: string) => void; label: string}) {
  const {c, dark} = useTheme();
  const [h, m] = value.split(":").map(Number), date = new Date(2026, 0, 1, h, m);
  const set = (d: Date) => onChange(nowHM(d));
  if (Platform.OS === "ios") return (
    <View style={{alignItems: "flex-start"}}>
      <DateTimePicker value={date} mode="time" display="compact" themeVariant={dark ? "dark" : "light"} accentColor={c.ink} accessibilityLabel={label} minuteInterval={5}
        onValueChange={(_, d) => set(d)} />
    </View>
  );
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${label}, ${niceTime(value)}`}
      onPress={() => DateTimePickerAndroid.open({value: date, mode: "time", onValueChange: (_, d) => set(d)})}
      style={{borderWidth: 1, borderColor: c.line, borderRadius: radius.control, borderCurve: "continuous", paddingHorizontal: s[4], paddingVertical: s[3], alignSelf: "flex-start"}}>
      <T weight="semibold">{niceTime(value)}</T>
    </Pressable>
  );
}

/**
 * A date picker that reads and writes "YYYY-MM-DD". iOS shows the compact picker, or the whole month with `inline`; Android opens its dialog.
 */
export function DateField({value, onChange, min, max, label, inline}: {value: IsoDate; onChange: (d: IsoDate) => void; min?: IsoDate; max?: IsoDate; label: string; inline?: boolean}) {
  const {c, dark} = useTheme();
  const date = parseD(value);
  const bounds = {minimumDate: min ? parseD(min) : undefined, maximumDate: max ? parseD(max) : undefined};
  if (Platform.OS === "ios") return (
    <View style={{alignItems: "flex-start"}}>
      <DateTimePicker value={date} mode="date" display={inline ? "inline" : "compact"} themeVariant={dark ? "dark" : "light"} accentColor={c.ink} accessibilityLabel={label}
        onValueChange={(_, d) => onChange(isoD(d))} {...bounds} />
    </View>
  );
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${label}, ${niceDate(value)}`}
      onPress={() => DateTimePickerAndroid.open({value: date, mode: "date", onValueChange: (_, d) => onChange(isoD(d)), ...bounds})}
      style={{borderWidth: 1, borderColor: c.line, borderRadius: radius.control, borderCurve: "continuous", paddingHorizontal: s[4], paddingVertical: s[3], alignSelf: "flex-start"}}>
      <T weight="semibold">{niceDate(value)}</T>
    </Pressable>
  );
}
