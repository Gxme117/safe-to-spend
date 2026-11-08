import {useEffect} from "react";
import {AccessibilityInfo, Pressable, View} from "react-native";
import {useSafeAreaInsets} from "react-native-safe-area-context";
import {useMoney} from "@/store/useMoney";
import {font, living, radius, s} from "@/theme/tokens";
import {useTheme} from "@/theme/useTheme";
import {T} from "./ui";

// how long it stays: one with Undo waits longer, so there's time to reach it
const SHOW = 2600, SHOW_UNDO = 5000;

/** One short message at the bottom. Good news (money arriving, on track) gets the accent. One that removed something
 *  ("Netflix removed") has Undo at its end, as in the Living reference: the words left, Undo in bold on the right. */
export function Toast() {
  const toast = useMoney(st => st.toast);
  const {c, dark} = useTheme();
  const insets = useSafeAreaInsets();
  useEffect(() => {
    if (!toast) return;
    AccessibilityInfo.announceForAccessibility(toast.undo ? `${toast.msg}. Undo` : toast.msg);
    const t = setTimeout(() => { if (useMoney.getState().toast?.id === toast.id) useMoney.setState({toast: null}); }, toast.undo ? SHOW_UNDO : SHOW);
    return () => clearTimeout(t);
  }, [toast]);
  if (!toast) return null;
  if (toast.undo) {
    const undo = toast.undo;
    return (
      <View pointerEvents="box-none" style={{position: "absolute", left: s[4], right: s[4], bottom: insets.bottom + 72}}>
        <View style={{height: 52, borderRadius: 14, borderCurve: "continuous", backgroundColor: c.ink, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingLeft: 18, paddingRight: 6}}>
          <T weight="medium" lines={1} style={{flex: 1, color: c.bg, fontSize: 15}}>{toast.msg}</T>
          <Pressable onPress={() => { useMoney.setState({toast: null}); undo(); }} accessibilityRole="button" accessibilityLabel="Undo"
            style={({pressed}) => ({height: 44, paddingHorizontal: 14, justifyContent: "center", opacity: pressed ? 0.7 : 1})}>
            {/* the highlight's yellow on the dark toast; on dark mode's light toast it would wash out, so it's in bold ink there */}
            <T weight="bold" style={{color: dark ? living.hlInk : living.hlEdge, fontSize: 15}}>Undo</T>
          </Pressable>
        </View>
      </View>
    );
  }
  return (
    <View pointerEvents="none" style={{position: "absolute", left: s[4], right: s[4], bottom: insets.bottom + 72, alignItems: "center"}}>
      <View style={{backgroundColor: toast.good ? c.accent : c.ink, borderRadius: radius.control, borderCurve: "continuous", paddingVertical: s[3], paddingHorizontal: s[4]}}>
        <T weight="semibold" size="md" style={{color: toast.good ? c.accentInk : c.bg, fontFamily: font.semibold, textAlign: "center"}}>{toast.msg}</T>
      </View>
    </View>
  );
}
