import {BricolageGrotesque_700Bold, BricolageGrotesque_800ExtraBold} from "@expo-google-fonts/bricolage-grotesque";
import {Inter_700Bold, Inter_800ExtraBold} from "@expo-google-fonts/inter";
import {Manrope_400Regular, Manrope_500Medium, Manrope_600SemiBold, Manrope_700Bold, Manrope_800ExtraBold, useFonts} from "@expo-google-fonts/manrope";
import {Stack} from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import {StatusBar} from "expo-status-bar";
import {useEffect} from "react";
import {AppState} from "react-native";
import {Toast} from "@/components/Toast";
import {useMoney} from "@/store/useMoney";
import {font, textSize} from "@/theme/tokens";
import {useTheme} from "@/theme/useTheme";

SplashScreen.preventAutoHideAsync().catch(() => {});

export default function RootLayout() {
  const [fontsLoaded] = useFonts({Manrope_400Regular, Manrope_500Medium, Manrope_600SemiBold, Manrope_700Bold, Manrope_800ExtraBold, BricolageGrotesque_700Bold, BricolageGrotesque_800ExtraBold, Inter_700Bold, Inter_800ExtraBold});
  const hasState = useMoney(st => !!st.state), loaded = useMoney(st => st.loaded);
  const {c, dark} = useTheme();

  useEffect(() => {
    useMoney.getState().load().catch(() => {
      useMoney.setState({loaded: true});
      useMoney.getState().notify("Couldn't read your payments. Close the app and open it again.");
    });
    // a new day when the app comes back: the daily number moves on
    const sub = AppState.addEventListener("change", st => { if (st === "active") useMoney.getState().tick(); });
    return () => sub.remove();
  }, []);
  useEffect(() => { if (fontsLoaded && loaded) SplashScreen.hide(); }, [fontsLoaded, loaded]);
  if (!fontsLoaded || !loaded) return null;

  const modal = (title: string) => ({presentation: "modal" as const, title});
  return (
    <>
      <StatusBar style={dark ? "light" : "dark"} />
      <Stack screenOptions={{
        headerStyle: {backgroundColor: c.bg}, headerTintColor: c.ink, headerShadowVisible: false,
        headerTitleStyle: {fontFamily: font.headBold, fontSize: textSize.lg}, contentStyle: {backgroundColor: c.bg},
      }}>
        <Stack.Protected guard={!hasState}>
          <Stack.Screen name="setup" options={{headerShown: false}} />
        </Stack.Protected>
        <Stack.Protected guard={hasState}>
          <Stack.Screen name="(tabs)" options={{headerShown: false}} />
          <Stack.Screen name="add-payment" options={modal("Add a payment")} />
          <Stack.Screen name="payment/[id]" options={modal("Payment")} />
          <Stack.Screen name="income/[id]" options={modal("Income")} />
          {/* a pop-up over the page rather than a sheet: it draws its own card and dimmed backdrop */}
          <Stack.Screen name="expect" options={{presentation: "transparentModal", animation: "fade", headerShown: false, contentStyle: {backgroundColor: "transparent"}}} />
          <Stack.Screen name="bill/[id]" options={modal("Bill")} />
          <Stack.Screen name="everyday" options={modal("Everyday")} />
          <Stack.Screen name="today" options={modal("Today's number")} />
        </Stack.Protected>
        {/* from setup too: the first question can be answered by the bank */}
        <Stack.Screen name="connect-bank" options={modal("Connect Monzo")} />
      </Stack>
      <Toast />
    </>
  );
}
