import {useEffect} from "react";
import {AccessibilityInfo, View} from "react-native";
import {useSafeAreaInsets} from "react-native-safe-area-context";
import {useMoney} from "@/store/useMoney";
import {font, radius, s} from "@/theme/tokens";
import {useTheme} from "@/theme/useTheme";
import {T} from "./ui";

/** One short message at the bottom. Good news (money arriving, on track) gets the accent. */
export function Toast() {
  const toast = useMoney(st => st.toast);
  const {c} = useTheme();
  const insets = useSafeAreaInsets();
  useEffect(() => {
    if (!toast) return;
    AccessibilityInfo.announceForAccessibility(toast.msg);
    const t = setTimeout(() => { if (useMoney.getState().toast?.id === toast.id) useMoney.setState({toast: null}); }, 2600);
    return () => clearTimeout(t);
  }, [toast]);
  if (!toast) return null;
  return (
    <View pointerEvents="none" style={{position: "absolute", left: s[4], right: s[4], bottom: insets.bottom + 72, alignItems: "center"}}>
      <View style={{backgroundColor: toast.good ? c.accent : c.ink, borderRadius: radius.control, paddingVertical: s[3], paddingHorizontal: s[4]}}>
        <T weight="semibold" size={15} style={{color: toast.good ? c.accentInk : c.bg, fontFamily: font.semibold, textAlign: "center"}}>{toast.msg}</T>
      </View>
    </View>
  );
}
