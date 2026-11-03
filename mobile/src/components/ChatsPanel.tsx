import {Alert, Image, Pressable, ScrollView, Text, TextInput, View} from "react-native";
import type {Who} from "@/lib/ai/tools";
import {Icon} from "@/components/Icon";
import {Logo} from "@/components/Logo";
import {groupsOf, matches, type ChatRow} from "@/lib/chats";
import {hanken, timPage} from "@/theme/tokens";
import {useTheme} from "@/theme/useTheme";

const NAME = {tim: "Tim", frank: "Frank"} as const;

/** His face, cropped as his bubble is: his picture (w × h px), the bubble's scale (pt per px) and the px at its top left,
 *  for a bubble `size` pt across. */
export type Face = {pic: number; scale: number; x: number; y: number; size: number; w: number; h: number};
const DOT = 32;
// the other tabs, with the tab bar's icons
const PLACES = [
  {href: "/", title: "Today", icon: "home"},
  {href: "/living", title: "Living", icon: "pit"},
  {href: "/month", title: "Coming up", icon: "month"},
  {href: "/settings", title: "Settings", icon: "sliders"},
] as const;
export type Place = (typeof PLACES)[number]["href"];

/** A small round picture of who the chat was with: his bubble's crop, scaled down. */
function FaceDot({who, face, bg}: {who: Who; face: Face; bg: string}) {
  const s = face.scale * DOT / face.size;
  return (
    <View testID={`chat-face-${who}`} accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
      style={{width: DOT, height: DOT, borderRadius: DOT / 2, overflow: "hidden", backgroundColor: bg}}>
      <Image source={face.pic} style={{position: "absolute", left: -face.x * s, top: -face.y * s, width: face.w * s, height: face.h * s}} />
    </View>
  );
}

/** What's inside the recent chats panel on Tim and Frank's tab, as in the ChatGPT app: the app's name, a search box, the chats
 *  of the last 30 days in their groups (Tim's and Frank's together, each with his face on the left), and "Chat" for a new one at
 *  the bottom left. Tap a chat to open it; press and hold to delete it, after asking. */
export function ChatsPanel({rows, now, openIds, query, onQuery, onOpen, onDelete, onNew, onGo, tone, bottom, faces}: {
  rows: ChatRow[]; now: number; openIds: string[]; query: string; onQuery: (q: string) => void;
  onOpen: (id: string) => void; onDelete: (id: string) => void; onNew: () => void; onGo: (href: Place) => void;
  tone: (typeof timPage)["light"]; bottom: number; faces: Record<Who, Face>;
}) {
  const {c} = useTheme();
  const groups = groupsOf(rows.filter(r => matches(r, query)), now);
  const askDelete = (r: ChatRow) => Alert.alert("Delete this chat?", r.title, [
    {text: "Cancel", style: "cancel"},
    {text: "Delete", style: "destructive", onPress: () => onDelete(r.id)},
  ]);
  return (
    <View style={{flex: 1}}>
      <View style={{height: 32, flexDirection: "row", alignItems: "center", gap: 8}}>
        <Text accessibilityRole="header" style={{fontFamily: hanken.bold, fontSize: 22, lineHeight: 28, letterSpacing: -.22, color: c.ink}}>Pinch</Text>
        {/* the logo is said with the name, not on its own */}
        <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants"><Logo height={20} /></View>
      </View>
      <View style={{marginTop: 16, height: 40, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, borderRadius: 20, backgroundColor: tone.track}}>
        <Icon name="search" color={c.muted} size={18} />
        <TextInput value={query} onChangeText={onQuery} placeholder="Search chats" placeholderTextColor={c.muted} accessibilityLabel="Search chats"
          autoComplete="off" autoCorrect={false} returnKeyType="search" clearButtonMode="while-editing"
          style={{flex: 1, minWidth: 0, padding: 0, fontFamily: hanken.medium, fontSize: 16, color: c.ink}} />
      </View>
      <ScrollView style={{flex: 1, marginHorizontal: -12}} contentContainerStyle={{paddingHorizontal: 12, paddingTop: 8, paddingBottom: 72}}
        keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" showsVerticalScrollIndicator={false}>
        {/* the rest of the app, since his tab has no tab bar (a trial) */}
        <View style={{marginTop: 8}}>
          {PLACES.map(p => (
            <Pressable key={p.href} onPress={() => onGo(p.href)} accessibilityRole="link" accessibilityLabel={p.title}
              style={{flexDirection: "row", alignItems: "center", gap: 12, minHeight: 44, marginHorizontal: -12, paddingHorizontal: 12, borderRadius: 12}}>
              <View style={{width: DOT, alignItems: "center"}}><Icon name={p.icon} color={c.ink} size={22} /></View>
              <Text style={{flex: 1, fontFamily: hanken.medium, fontSize: 16, lineHeight: 21, color: c.ink}}>{p.title}</Text>
            </Pressable>
          ))}
        </View>
        {!groups.length && (
          <Text style={{marginTop: 16, fontFamily: hanken.medium, fontSize: 15, lineHeight: 20, color: c.muted}}>
            {rows.length ? "No chats match that" : "No chats yet"}
          </Text>
        )}
        {groups.map(g => (
          <View key={g.label} style={{marginTop: 16}}>
            <Text accessibilityRole="header" style={{fontFamily: hanken.medium, fontSize: 13, lineHeight: 18, color: c.muted, marginBottom: 4}}>{g.label}</Text>
            {g.rows.map(r => {
              const on = openIds.includes(r.id);
              return (
                <Pressable key={r.id} onPress={() => onOpen(r.id)} onLongPress={() => askDelete(r)}
                  accessibilityRole="button" accessibilityLabel={`${r.title}, with ${NAME[r.who]}`} accessibilityHint="Opens the chat. Press and hold to delete it."
                  accessibilityState={{selected: on}}
                  style={{flexDirection: "row", alignItems: "center", gap: 12, minHeight: 44, marginHorizontal: -12, paddingHorizontal: 12, borderRadius: 12, backgroundColor: on ? tone.track : "transparent"}}>
                  <FaceDot who={r.who} face={faces[r.who]} bg={tone.track} />
                  <Text numberOfLines={1} style={{flex: 1, minWidth: 0, fontFamily: hanken.medium, fontSize: 16, lineHeight: 21, color: c.ink}}>{r.title}</Text>
                </Pressable>
              );
            })}
          </View>
        ))}
      </ScrollView>
      {/* a new chat, at the bottom left */}
      <Pressable onPress={onNew} accessibilityRole="button" accessibilityLabel="New chat" hitSlop={8}
        style={{position: "absolute", left: 0, bottom, height: 44, paddingLeft: 16, paddingRight: 20, borderRadius: 22, flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: tone.send}}>
        <Icon name="pencil" color={tone.sendInk} size={18} />
        <Text style={{fontFamily: hanken.semibold, fontSize: 16, color: tone.sendInk}}>Chat</Text>
      </Pressable>
    </View>
  );
}
