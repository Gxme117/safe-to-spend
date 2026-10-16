import {Tabs} from "expo-router";
import {useSafeAreaInsets} from "react-native-safe-area-context";
import {Icon} from "@/components/Icon";
import {font, textSize} from "@/theme/tokens";
import {useTheme} from "@/theme/useTheme";

export default function TabsLayout() {
  const {c} = useTheme();
  const top = useSafeAreaInsets().top;
  return (
    <Tabs screenOptions={{
      headerShown: false, // each page shows its own big title
      sceneStyle: {backgroundColor: c.bg, paddingTop: top},
      tabBarStyle: {backgroundColor: c.bg, borderTopColor: c.line},
      tabBarActiveTintColor: c.ink, tabBarInactiveTintColor: c.muted,
      tabBarLabelStyle: {fontFamily: font.semibold, fontSize: textSize.xs},
    }}>
      <Tabs.Screen name="index" options={{title: "Day", tabBarIcon: ({color}) => <Icon name="day" color={color} />}} />
      {/* the Day tab redesigned, beside the first one while it's tried out */}
      <Tabs.Screen name="day2" options={{title: "Day 2", tabBarIcon: ({color}) => <Icon name="clock" color={color} />}} />
      <Tabs.Screen name="month" options={{title: "Month", tabBarIcon: ({color}) => <Icon name="month" color={color} />}} />
      <Tabs.Screen name="settings" options={{title: "Settings", tabBarIcon: ({color}) => <Icon name="settings" color={color} />}} />
    </Tabs>
  );
}

