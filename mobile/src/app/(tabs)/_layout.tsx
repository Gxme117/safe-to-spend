import {router, Tabs} from "expo-router";
import {Pressable} from "react-native";
import {Icon} from "@/components/Icon";
import {longDate} from "@/lib/dates";
import {useMoney} from "@/store/useMoney";
import {font, s} from "@/theme/tokens";
import {useTheme} from "@/theme/useTheme";

export default function TabsLayout() {
  const {c} = useTheme();
  const today = useMoney(st => st.today);
  return (
    <Tabs screenOptions={{
      headerStyle: {backgroundColor: c.bg}, headerShadowVisible: false, headerTintColor: c.ink,
      headerTitleStyle: {fontFamily: font.heavy, fontSize: 20}, headerTitleAlign: "left",
      sceneStyle: {backgroundColor: c.bg},
      tabBarStyle: {backgroundColor: c.bg, borderTopColor: c.line},
      tabBarActiveTintColor: c.ink, tabBarInactiveTintColor: c.muted,
      tabBarLabelStyle: {fontFamily: font.semibold, fontSize: 12},
      headerRight: () => (
        <Pressable onPress={() => router.push("/settings")} accessibilityRole="button" accessibilityLabel="Settings" hitSlop={8} style={{paddingHorizontal: s[4]}}>
          <Icon name="settings" color={c.ink} />
        </Pressable>
      ),
    }}>
      <Tabs.Screen name="index" options={{title: "Day", headerTitle: longDate(today), tabBarIcon: ({color}) => <Icon name="day" color={color} />}} />
      <Tabs.Screen name="month" options={{title: "Month", headerTitle: "Payday to payday", tabBarIcon: ({color}) => <Icon name="month" color={color} />}} />
    </Tabs>
  );
}
