import {Modal, ScrollView, View} from "react-native";
import {useSafeAreaInsets} from "react-native-safe-area-context";
import {Button, T} from "@/components/ui";
import {s} from "@/theme/tokens";
import {useTheme} from "@/theme/useTheme";

/**
 * Before Tim or Frank looks at your numbers the first time: what leaves the phone, to whom, and what never does. A native page
 * sheet, so his tab stays where it was underneath (a route over the tabs would make him start his hello again).
 * Yes sends the question you asked; Not now puts it back in the box. Switched off and on again in Settings.
 */
export function ConsentSheet({visible, name, onYes, onNo}: {visible: boolean; name: string; onYes: () => void; onNo: () => void}) {
  const {c} = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" allowSwipeDismissal onRequestClose={onNo}>
      <View style={{flex: 1, backgroundColor: c.bg}}>
        <ScrollView contentContainerStyle={{paddingHorizontal: s[5], paddingTop: s[6], paddingBottom: s[4], gap: s[4]}}>
          <T weight="bold" size="lg">Before {name} looks at your numbers</T>
          <T>To answer, he looks up what your question needs: your balance, bills, budgets and payments, and who they were with.</T>
          <T>Those figures, your question and what he&apos;s noted about you go to Anthropic, the company whose AI he runs on, through Pinch&apos;s own server. Pinch&apos;s server keeps none of it.</T>
          <T>To check a price or a service, he may search the web and open shops&apos; pages: Anthropic does that for him. What he looks for is the product or service, never your balance or your details.</T>
          <T>He also says one short line of each answer out loud: that line goes to ElevenLabs, the company that makes his voice, through the same server, which keeps none of it.</T>
          <T>Never sent: your account numbers, sort codes or bank logins.</T>
          <T muted>You can switch this off in Settings at any time, and delete anything he&apos;s noted.</T>
        </ScrollView>
        <View style={{paddingHorizontal: s[5], paddingTop: s[3], paddingBottom: insets.bottom + s[4], gap: s[2]}}>
          <Button label="Agree and ask" onPress={onYes} />
          <Button kind="ghost" label="Not now" onPress={onNo} />
        </View>
      </View>
    </Modal>
  );
}
