import {router} from "expo-router";
import {View} from "react-native";
import type {Hero} from "@/lib/calc";
import {s} from "@/theme/tokens";
import {Button, T} from "./ui";

type Kind = Exclude<Hero["kind"], "number">;
const COPY: Record<Kind, {title: string; text: string; action?: string}> = {
  "no-income": {title: "Start with your income", text: "Add where your money comes from and your daily number is worked out from it.", action: "Add your income"},
  "payday-today": {title: "Payday is today", text: "Confirm your pay below and the daily number counts down to your next payday."},
  "no-payday": {title: "No payday coming up", text: "Add a regular income so there's a payday to count down to.", action: "Add income"},
};

/** Where today's number goes when there isn't one yet: what's missing, in one sentence, and the way to add it. */
export function HeroEmpty({kind}: {kind: Kind}) {
  const {title, text, action} = COPY[kind];
  return (
    <View style={{gap: s[3], paddingTop: s[4]}}>
      <T size="xl" weight="head">{title}</T>
      <T muted>{text}</T>
      {action ? <View style={{alignSelf: "flex-start"}}><Button label={action} onPress={() => router.push("/income/new")} /></View> : null}
    </View>
  );
}
