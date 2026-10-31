import Constants, {ExecutionEnvironment} from "expo-constants";
import {Fragment, useEffect, type ReactNode} from "react";
import {Keyboard} from "react-native";
import {useSharedValue, withTiming, type SharedValue} from "react-native-reanimated";

// Expo Go has no keyboard-controller (it's a native module), so there the box follows React Native's keyboard events instead:
// it eases up with the keys rather than tracking them frame by frame, and doesn't follow a drag. The dev build has it.
const expoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;
// eslint-disable-next-line @typescript-eslint/no-require-imports -- loaded only when it's there
const controller: typeof import("react-native-keyboard-controller") | null = expoGo ? null : require("react-native-keyboard-controller");

export function KeyboardProvider({children}: {children: ReactNode}) {
  const Provider = controller?.KeyboardProvider ?? Fragment;
  return <Provider>{children}</Provider>;
}

// minus the keyboard's height, this frame (as keyboard-controller reports it)
function useEventKeyboard(): {height: SharedValue<number>} {
  const height = useSharedValue(0);
  useEffect(() => {
    const show = Keyboard.addListener("keyboardWillShow", e => { height.value = withTiming(-e.endCoordinates.height, {duration: e.duration || 250}); });
    const hide = Keyboard.addListener("keyboardWillHide", e => { height.value = withTiming(0, {duration: e.duration || 250}); });
    return () => { show.remove(); hide.remove(); };
  }, [height]);
  return {height};
}

export const useKeyboardHeight: () => {height: SharedValue<number>} = controller ? controller.useReanimatedKeyboardAnimation : useEventKeyboard;
