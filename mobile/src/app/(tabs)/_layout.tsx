import {Tabs} from "expo-router";
import {useSafeAreaInsets} from "react-native-safe-area-context";
import {Icon} from "@/components/Icon";
import {hanken, home, timPage} from "@/theme/tokens";
import {useMoney} from "@/store/useMoney";
import {useTheme} from "@/theme/useTheme";

// the tab bar as drawn (the minimal design): taller than the system's, its icons and labels where the design has them
const BAR = 56, ICON = 22, LABEL = 11;

export default function TabsLayout() {
  const {c, dark} = useTheme();
  const {top, bottom} = useSafeAreaInsets();
  const bar = {height: BAR + bottom, paddingTop: 2, borderTopWidth: 1};
  // Today keeps the colours it was drawn in, its tab bar too
  const look = {...c, ...home[dark ? "dark" : "light"].page};
  const accountant = useMoney(st => st.accountant);
  return (
    <Tabs screenOptions={{
      headerShown: false, // each page shows its own big title
      sceneStyle: {backgroundColor: c.bg, paddingTop: top},
      tabBarStyle: {...bar, backgroundColor: c.bg, borderTopColor: c.line},
      tabBarActiveTintColor: c.ink, tabBarInactiveTintColor: c.muted,
      tabBarLabelStyle: {fontFamily: hanken.semibold, fontSize: LABEL, marginTop: 3},
    }}>
      {/* Today: the minimal design. Its bank cards hang down from the very top, under the status bar */}
      <Tabs.Screen name="index" options={{title: "Today", sceneStyle: {backgroundColor: look.bg},
        tabBarStyle: {...bar, backgroundColor: look.bg, borderTopColor: look.line}, tabBarActiveTintColor: look.ink, tabBarInactiveTintColor: look.muted,
        tabBarIcon: ({color}) => <Icon name="home" color={color} size={ICON} />}} />
      {/* Living: your cost of living as a ball pit, in Today's look like Today */}
      <Tabs.Screen name="living" options={{title: "Living", sceneStyle: {backgroundColor: look.bg},
        tabBarStyle: {...bar, backgroundColor: look.bg, borderTopColor: look.line}, tabBarActiveTintColor: look.ink, tabBarInactiveTintColor: look.muted,
        tabBarIcon: ({color}) => <Icon name="pit" color={color} size={ICON} />}} />
      {/* Tim, your accountant, in the middle: his picture runs up under the status bar, in Today's look */}
      <Tabs.Screen name="tim" options={{title: accountant === "frank" ? "Frank" : "Tim", sceneStyle: {backgroundColor: dark ? look.bg : timPage, paddingTop: 0},
        tabBarStyle: {...bar, backgroundColor: dark ? look.bg : timPage, borderTopColor: look.line}, tabBarActiveTintColor: look.ink, tabBarInactiveTintColor: look.muted,
        tabBarIcon: ({color}) => <Icon name="glasses" color={color} size={ICON} />}} />
      <Tabs.Screen name="month" options={{title: "Coming up", tabBarIcon: ({color}) => <Icon name="month" color={color} size={ICON} />}} />
      <Tabs.Screen name="settings"options={{title: "Settings", tabBarIcon: ({color}) => <Icon name="sliders" color={color} size={ICON} />}} />
      {/* the Day tab and its redesign, kept while Today is tried out, off the tab bar */}
      <Tabs.Screen name="day" options={{href: null}} />
      <Tabs.Screen name="day2" options={{href: null}} />
    </Tabs>
  );
}
