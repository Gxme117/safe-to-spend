import {Alert, Pressable, ScrollView, Text, TextInput, View} from "react-native";
import {Icon} from "@/components/Icon";
import {Logo} from "@/components/Logo";
import {groupsOf, matches, type ChatRow} from "@/lib/chats";
import {hanken, timPage} from "@/theme/tokens";
import {useTheme} from "@/theme/useTheme";

const NAME = {tim: "Tim", frank: "Frank"} as const;

/** What's inside the recent chats panel on Tim and Frank's tab, as in the ChatGPT app: the app's name, a search box, the chats
 *  of the last 30 days in their groups (Tim's and Frank's together, each tagged), and "Chat" for a new one at the bottom left.
 *  Tap a chat to open it; press and hold to delete it, after asking. */
export function ChatsPanel({rows, now, openIds, query, onQuery, onOpen, onDelete, onNew, tone, bottom}: {
  rows: ChatRow[]; now: number; openIds: string[]; query: string; onQuery: (q: string) => void;
  onOpen: (id: string) => void; onDelete: (id: string) => void; onNew: () => void;
  tone: (typeof timPage)["light"]; bottom: number;
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
                  style={{flexDirection: "row", alignItems: "center", gap: 8, minHeight: 44, marginHorizontal: -12, paddingHorizontal: 12, borderRadius: 12, backgroundColor: on ? tone.track : "transparent"}}>
                  <Text numberOfLines={1} style={{flex: 1, minWidth: 0, fontFamily: hanken.medium, fontSize: 16, lineHeight: 21, color: c.ink}}>{r.title}</Text>
                  <Text style={{fontFamily: hanken.medium, fontSize: 13, lineHeight: 18, color: c.muted}}>{NAME[r.who]}</Text>
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
