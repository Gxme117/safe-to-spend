import {router, Tabs} from "expo-router";
import {Pressable, Text, View} from "react-native";
import {Icon} from "@/components/Icon";
import {useMoney} from "@/store/useMoney";
import {font, radius, s, textSize} from "@/theme/tokens";
import {useTheme} from "@/theme/useTheme";

export default function TabsLayout() {
  const {c} = useTheme();
  return (
    <Tabs screenOptions={{
      headerStyle: {backgroundColor: c.bg}, headerShadowVisible: false, headerTintColor: c.ink,
      headerTitle: () => null, // each page shows its own big title, below the buttons
      sceneStyle: {backgroundColor: c.bg},
      tabBarStyle: {backgroundColor: c.bg, borderTopColor: c.line},
      tabBarActiveTintColor: c.ink, tabBarInactiveTintColor: c.muted,
      tabBarLabelStyle: {fontFamily: font.semibold, fontSize: textSize.xs},
      headerLeft: () => <AccountButton />,
      headerRight: () => (
        <Pressable onPress={() => router.push("/settings")} accessibilityRole="button" accessibilityLabel="Settings" hitSlop={8} style={{paddingHorizontal: s[4]}}>
          <Icon name="settings" color={c.ink} />
        </Pressable>
      ),
    }}>
      <Tabs.Screen name="index" options={{title: "Day", tabBarIcon: ({color}) => <Icon name="day" color={color} />}} />
      <Tabs.Screen name="month" options={{title: "Month", tabBarIcon: ({color}) => <Icon name="month" color={color} />}} />
    </Tabs>
  );
}

/** Your initial once you've set a name, a person icon until then. */
function AccountButton() {
  const {c} = useTheme();
  const name = useMoney(st => st.state?.name);
  return (
    <Pressable onPress={() => router.push("/account")} accessibilityRole="button" accessibilityLabel="Account" hitSlop={8}
      style={({pressed}) => ({paddingLeft: s[4], paddingRight: s[3], opacity: pressed ? 0.5 : 1})}>
      {name
        ? <View style={{width: 32, height: 32, borderRadius: radius.pill, backgroundColor: c.surface, alignItems: "center", justifyContent: "center"}}>
            <Text style={{fontFamily: font.bold, fontSize: textSize.sm, color: c.ink}}>{name[0].toUpperCase()}</Text>
          </View>
        : <Icon name="account" color={c.ink} />}
    </Pressable>
  );
}
