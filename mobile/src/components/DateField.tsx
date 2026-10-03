import DateTimePicker, {DateTimePickerAndroid} from "@react-native-community/datetimepicker";
import {Platform, Pressable, View} from "react-native";
import {isoD, niceDate, parseD} from "@/lib/dates";
import type {IsoDate} from "@/lib/types";
import {radius, s} from "@/theme/tokens";
import {useTheme} from "@/theme/useTheme";
import {T} from "./ui";

/** A date picker that reads and writes "YYYY-MM-DD". iOS shows the compact picker; Android opens its dialog. */
export function DateField({value, onChange, min, max, label}: {value: IsoDate; onChange: (d: IsoDate) => void; min?: IsoDate; max?: IsoDate; label: string}) {
  const {c, dark} = useTheme();
  const date = parseD(value);
  const bounds = {minimumDate: min ? parseD(min) : undefined, maximumDate: max ? parseD(max) : undefined};
  if (Platform.OS === "ios") return (
    <View style={{alignItems: "flex-start"}}>
      <DateTimePicker value={date} mode="date" display="compact" themeVariant={dark ? "dark" : "light"} accessibilityLabel={label}
        onValueChange={(_, d) => onChange(isoD(d))} {...bounds} />
    </View>
  );
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${label}, ${niceDate(value)}`}
      onPress={() => DateTimePickerAndroid.open({value: date, mode: "date", onValueChange: (_, d) => onChange(isoD(d)), ...bounds})}
      style={{borderWidth: 1, borderColor: c.line, borderRadius: radius.control, paddingHorizontal: s[4], paddingVertical: s[3], alignSelf: "flex-start"}}>
      <T weight="semibold">{niceDate(value)}</T>
    </Pressable>
  );
}
