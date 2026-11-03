import {create} from "zustand";

/** What the app's frame shows, set by a screen and read by the tab layout. Not kept: a trial for now (the tab bar
 *  hides while a conversation with Tim or Frank is going, and comes back with a new chat or when you leave). */
export const useChrome = create<{bare: boolean; setBare: (bare: boolean) => void}>(set => ({
  bare: false,
  setBare: bare => set({bare}),
}));
