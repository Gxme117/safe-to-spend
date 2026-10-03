import {useMemo} from "react";
import {calc, type Calc} from "@/lib/calc";
import type {Ctx} from "@/lib/types";
import {useMoney} from "./useMoney";

/** The engine's view of right now. Only recalculates when the state, payments or date change. */
export function useCalc(): {ctx: Ctx; c: Calc} | null {
  const state = useMoney(s => s.state), txs = useMoney(s => s.txs), today = useMoney(s => s.today);
  return useMemo(() => {
    if (!state) return null;
    const ctx = {state, txs, today};
    return {ctx, c: calc(ctx)};
  }, [state, txs, today]);
}
