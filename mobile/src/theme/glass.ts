import {isGlassEffectAPIAvailable, isLiquidGlassAvailable} from "expo-glass-effect";

/** Liquid Glass needs iOS 26 (and an API some iOS 26 betas lack). Anywhere else there's no glass to choose. */
export const GLASS = (() => { try { return isLiquidGlassAvailable() && isGlassEffectAPIAvailable(); } catch { return false; } })();
