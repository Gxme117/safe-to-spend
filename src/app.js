/* iPhone frame on wide screens; the real phone just gets the app */
(function () {
  const root = document.documentElement, btn = document.getElementById("frameBtn"), dev = document.getElementById("device");
  const wide = matchMedia("(min-width: 700px)");
  const pref = () => { try { return localStorage.getItem("frame") !== "off"; } catch (e) { return true; } };
  function fit() {
    if (!root.classList.contains("framed")) return;
    dev.style.setProperty("--s", Math.min(1, (innerHeight - 40) / 980, (innerWidth - 40) / 464).toFixed(3));
  }
  function apply() {
    const on = wide.matches && pref();
    root.classList.toggle("framed", on);
    btn.hidden = !wide.matches;
    btn.textContent = on ? "Full page" : "iPhone view";
    fit();
  }
  btn.onclick = () => { try { localStorage.setItem("frame", pref() ? "off" : "on"); } catch (e) {} apply(); };
  wide.addEventListener("change", apply);
  addEventListener("resize", fit);
  const tick = () => { document.getElementById("sbTime").textContent = new Date().toLocaleTimeString("en-GB", {hour: "numeric", minute: "2-digit"}); };
  tick(); setInterval(tick, 30000);
  apply();
})();
(() => {
  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const r2 = n => Math.round(n * 100) / 100;
  const money = (n, sign) => {
    const v = r2(n), a = Math.abs(v);
    const s = "£" + a.toLocaleString("en-GB", {minimumFractionDigits: Number.isInteger(a) ? 0 : 2, maximumFractionDigits: 2});
    if (v < 0) return "−" + s;
    return (sign && v > 0 ? "+" : "") + s;
  };
  const pad = n => String(n).padStart(2, "0");
  const today = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; };
  const parseD = s => { const [y,m,d] = s.split("-").map(Number); return new Date(y, m-1, d); };
  const dayDiff = (a, b) => Math.round((Date.UTC(...b.split("-").map((v,i)=>i===1?v-1:+v)) - Date.UTC(...a.split("-").map((v,i)=>i===1?v-1:+v))) / 864e5);
  const niceDate = s => parseD(s).toLocaleDateString("en-GB", {weekday:"short", day:"numeric", month:"short"});
  const monthName = k => parseD(k + "-01").toLocaleDateString("en-GB", {month:"long", year:"numeric"});
  const addMonths = (k, n) => { const d = parseD(k + "-01"); d.setMonth(d.getMonth() + n); return `${d.getFullYear()}-${pad(d.getMonth()+1)}`; };
  const uid6 = () => Math.random().toString(36).slice(2, 10);
  const num = v => { const n = parseFloat(String(v).replace(/[£,\s]/g, "")); return Number.isFinite(n) ? n : NaN; };

  let db = null, uid = null, stateRef = null;
  let state = null, loaded = false;
  const months = {}, subs = {}, queues = {};
  let catSig = "";

  function flare() {
    const hh = $("#hero"); hh.classList.remove("flare"); void hh.offsetWidth; hh.classList.add("flare");
    clearTimeout(flare.t); flare.t = setTimeout(() => hh.classList.remove("flare"), 1800);
  }
  function toast(msg, good) {
    if (good) flare();
    const t = $("#toast"); t.textContent = msg;
    t.classList.remove("good", "pop"); void t.offsetWidth;
    if (good) t.classList.add("good", "pop");
    t.classList.add("show");
    clearTimeout(toast.h); toast.h = setTimeout(() => t.classList.remove("show"), 2600);
  }
  function enqueue(key, fn) {
    const p = (queues[key] || Promise.resolve()).then(fn, fn);
    queues[key] = p.catch(() => {});
    return p;
  }
  function failed(e) {
    if (e && e.code === "quota_exceeded") toast("Storage is full. Delete some old transactions and try again.");
    else toast("That didn't save. Check your connection and try again.");
  }

  /* ---------- data ---------- */
  function subscribeMonth(key) {
    if (subs[key] || !db) return;
    subs[key] = db.doc(`data/users/${uid}/tx-${key}`).onSnapshot(s => {
      months[key] = s.exists ? (s.data().items || []) : [];
      render();
    }, () => { delete subs[key]; });
  }
  function syncMonths() {
    const cur = today().slice(0, 7);
    let start = addMonths(cur, -1);
    if (state && state.balanceAsOf) {
      const a = state.balanceAsOf.slice(0, 7);
      if (a < start) start = a;
    }
    if (start < addMonths(cur, -11)) start = addMonths(cur, -11);
    for (let k = start; k <= cur; k = addMonths(k, 1)) subscribeMonth(k);
  }
  function saveState(next) {
    state = next; render();
    return enqueue("state", () => stateRef.set(next)).catch(failed);
  }
  function writeMonth(key, mutate) {
    subscribeMonth(key);
    return enqueue("tx" + key, async () => {
      const ref = db.doc(`data/users/${uid}/tx-${key}`);
      let items = months[key];
      if (!items) { const s = await ref.get(); items = s.exists ? (s.data().items || []) : []; }
      const next = mutate([...items]);
      months[key] = next; render();
      await ref.set({items: next});
    }).catch(failed);
  }


  /* ---------- income engine ---------- */
  const BANK_HOLIDAYS = new Set(["2026-01-01","2026-04-03","2026-04-06","2026-05-04","2026-05-25","2026-08-31","2026-12-25","2026-12-28",
    "2027-01-01","2027-03-26","2027-03-29","2027-05-03","2027-05-31","2027-08-30","2027-12-27","2027-12-28"]);
  const isoD = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
  const FREQ = {"monthly-lastworking":"Monthly, last working day","monthly-date":"Monthly","monthly-lastfri":"Monthly, last Friday",
    fourweekly:"Every 4 weeks", fortnightly:"Every 2 weeks", weekly:"Every week", oneoff:"Just once"};
  const incomes = () => (state && state.incomes) || [];
  function workingBefore(d) {
    const x = new Date(d);
    while (x.getDay() === 0 || x.getDay() === 6 || BANK_HOLIDAYS.has(isoD(x))) x.setDate(x.getDate() - 1);
    return x;
  }
  function occurrences(src, from, to) {
    const out = [], F = parseD(from), T = parseD(to);
    if (src.freq === "oneoff") { if (src.date && src.date >= from && src.date <= to) out.push(src.date); return out; }
    const step = {weekly: 7, fortnightly: 14, fourweekly: 28}[src.freq];
    if (step) {
      if (!src.date) return out;
      const a = parseD(src.date);
      const n = Math.floor((F - a) / 864e5 / step) - 1;
      for (let i = n; i < n + 400; i++) {
        const d = new Date(a); d.setDate(d.getDate() + i * step);
        const adj = workingBefore(d);
        if (adj > T) break;
        if (adj >= F) out.push(isoD(adj));
      }
      return out;
    }
    for (let i = -1; i < 40; i++) {
      const base = new Date(F.getFullYear(), F.getMonth() + i, 1);
      const last = new Date(base.getFullYear(), base.getMonth() + 1, 0);
      let d;
      if (src.freq === "monthly-lastworking") d = last;
      else if (src.freq === "monthly-lastfri") { d = new Date(last); while (d.getDay() !== 5) d.setDate(d.getDate() - 1); }
      else d = new Date(base.getFullYear(), base.getMonth(), Math.min(src.day || 1, last.getDate()));
      const adj = workingBefore(d);
      if (adj > T) break;
      if (adj >= F) out.push(isoD(adj));
    }
    return out;
  }
  const lowAmt = s => s.varies ? (s.low || 0) : (s.amount || 0);
  const usualAmt = s => s.varies ? (s.typical || s.low || 0) : (s.amount || 0);
  const perMonth = s => lowAmt(s) * ({weekly: 52/12, fortnightly: 26/12, fourweekly: 13/12, oneoff: 0}[s.freq] ?? 1);
  const addDays = (s, n) => { const d = parseD(s); d.setDate(d.getDate() + n); return isoD(d); };
  const ciKey = (id, d) => `${id}_${d}`;
  function isReceived(srcId, d) {
    for (const k in months) for (const it of months[k]) if (it.srcId === srcId && it.forDate === d) return true;
    return false;
  }
  function pendingCheckins() {
    const t = today(), res = [], skip = (state && state.skipped) || {}, snooze = (state && state.snoozed) || {};
    for (const s of incomes()) for (const d of occurrences(s, addDays(t, -40), t)) {
      if (s.since && d < s.since) continue;
      const k = ciKey(s.id, d);
      if (skip[k] || snooze[k] === t || isReceived(s.id, d)) continue;
      res.push({src: s, date: d, key: k});
    }
    return res.sort((a, b) => a.date.localeCompare(b.date));
  }
  function nextPaydayCalc() {
    const list = incomes().filter(s => s.freq !== "oneoff");
    if (!list.length) return null;
    const mains = list.filter(s => s.main);
    const use = mains.length ? mains : list, t = today(), skip = (state && state.skipped) || {};
    let best = null;
    for (const s of use) for (const d of occurrences(s, t, addDays(t, 70))) {
      if (isReceived(s.id, d) || skip[ciKey(s.id, d)]) continue;
      if (!best || d < best) best = d;
      break;
    }
    return best;
  }
  function incomeForMonth(k) {
    const from = k + "-01", to = isoD(new Date(+k.slice(0, 4), +k.slice(5), 0));
    let sum = 0;
    for (const s of incomes()) sum += occurrences(s, from, to).length * lowAmt(s);
    return sum;
  }

  /* ---------- derived ---------- */
  // every category belongs to one group: bills (fixed), everyday (monthly amount you choose), or free
  // nothing becomes Everyday until you choose it in the planner, so your number doesn't change by surprise
  function catGroup(x) { return x.group || (x.fixed ? "bills" : "free"); }
  function cycleStart(t) {
    const src = incomes().find(s => s.main) || incomes().find(s => s.freq !== "oneoff");
    if (!src) return t;
    const past = occurrences(src, addDays(t, -45), t);
    return past.length ? past[past.length - 1] : t;
  }
  function calc() {
    const t = today(), cur = t.slice(0, 7);
    const items = months[cur] || [];
    const cats = (state && state.categories) || [];
    const spent = {};
    let spentTotal = 0, inTotal = 0, savedMonth = 0;
    for (const it of items) {
      if (it.type === "expense") { spent[it.cat] = (spent[it.cat] || 0) + it.amount; spentTotal += it.amount; }
      else if (it.type === "income") inTotal += it.amount;
      else if (it.type === "save") savedMonth += it.amount;
    }
    let balance = null;
    if (state && typeof state.balance === "number") {
      balance = state.balance;
      for (const k in months) for (const it of months[k]) {
        if ((it.created || 0) <= (state.balanceSetAt || 0)) continue;
        balance += it.type === "income" ? it.amount : -it.amount;
      }
    }
    const payday = incomes().length ? nextPaydayCalc() : (state && state.nextPayday) || null;
    const daysLeft = payday ? dayDiff(t, payday) : null;
    let billsLeft = 0;
    const billsDue = [];
    if (bills().length) {
      // only bills that land before the next payday and haven't gone out yet
      const until = payday ? addDays(payday, -1) : addDays(t, 30);
      for (const b of bills()) for (const d of billDates(b, t, until)) if (!billPaid(b, d)) { billsLeft += b.amount || 0; billsDue.push({b, d}); }
      billsDue.sort((x, y) => x.d < y.d ? -1 : 1);
    } else {
      for (const c of cats) if (c.fixed) billsLeft += Math.max(0, (c.budget || 0) - (spent[c.id] || 0));
    }
    // everyday: what's left of each monthly amount since the last payday is kept aside, not counted as free
    const cycleFrom = cycleStart(t), spentCycle = {};
    for (const k in months) for (const it of months[k]) if (it.type === "expense" && !it.billId && it.date >= cycleFrom && it.date <= t) spentCycle[it.cat] = (spentCycle[it.cat] || 0) + it.amount;
    const everyday = cats.filter(x => catGroup(x) === "everyday").map(x => ({x, spent: r2(spentCycle[x.id] || 0), left: r2((x.budget || 0) - (spentCycle[x.id] || 0))}));
    const everydayLeft = r2(everyday.reduce((s, e) => s + Math.max(0, e.left), 0));
    const need = r2(billsLeft + everydayLeft);                       // what you need to pay before payday
    const savings = bank() ? r2(bank().pots.filter(p => p.role === "save").reduce((s, p) => s + (p.balance || 0), 0)) : 0;
    const short = balance == null ? 0 : r2(Math.max(0, need - balance));   // bills and everyday come first; savings is the back-up
    return {t, cur, items, cats, spent, spentTotal, inTotal, savedMonth, balance, billsLeft, billsDue, daysLeft, payday, everyday, everydayLeft, cycleFrom, need, savings, short};
  }

  /* ---------- pots (synced from the bank) ---------- */
  const bank = () => (state && state.bank && Array.isArray(state.bank.pots)) ? state.bank : null;
  const potName = x => String(x.name || "").trim();
  const potFor = catId => { const b = bank(); return b ? b.pots.find(x => (x.cats || []).includes(catId)) : null; };
  function renderPots() {
    const panel = $("#potsPanel"), b = bank();
    if (!b) { panel.hidden = true; return; }
    panel.hidden = false;
    const has = x => x.balance > 0, sum = a => a.reduce((s, x) => s + x.balance, 0);
    const spend = b.pots.filter(x => x.role === "spend" && has(x)), aside = b.pots.filter(x => x.role !== "spend" && has(x));
    const empty = b.pots.filter(x => !has(x)).length;
    const at = new Date(b.asOf);
    if (!refreshing) $("#potsWhen").textContent = $("#syncBtn").title = isoD(at) === today()
      ? `Updated from ${b.source || "your bank"} at ${at.toLocaleTimeString("en-GB", {hour: "2-digit", minute: "2-digit"})}`
      : `Updated from ${b.source || "your bank"} on ${niceDate(isoD(at))}`;
    const catName = id => ((state.categories || []).find(c => c.id === id) || {}).name;
    const row = (name, amt, meta, cls) => `<li${cls ? ` class="${cls}"` : ""}><div><span class="pname">${esc(name)}</span>${meta ? `<span class="pmeta">${esc(meta)}</span>` : ""}</div><span class="pamt num">${money(amt)}</span></li>`;
    const plain = t => String(t).toLowerCase().replace(/[^a-z ]/g, "").trim();
    const forText = x => {
      const n = (x.cats || []).map(catName).filter(Boolean);
      if (!n.length || (n.length === 1 && (plain(n[0]).includes(plain(x.name)) || plain(x.name).includes(plain(n[0]))))) return "";
      return `For ${n.join(", ")}`;
    };
    const goalText = x => x.goal ? `${Math.min(100, Math.round(x.balance / x.goal * 100))}% of ${money(x.goal)}` : "";
    const spendTotal = (b.main || 0) + sum(spend);
    const c0 = calc();
    const grand = r2((c0.balance != null ? c0.balance : spendTotal) + sum(aside));
    let html = `<ul class="pots"><li class="total grand"><div><span class="pname">Total balance</span><span class="pmeta">Everything in Monzo, including savings</span></div><span class="pamt num">${money(grand)}</span></li></ul>
    <p class="pot-group">Spending money</p>
    <ul class="pots">
      ${row("Main account", b.main || 0, (b.main || 0) < 1 ? "Empty. Card payments come from here" : "")}
      ${spend.map(x => row(potName(x), x.balance, forText(x))).join("")}
      ${row("Spending money", spendTotal, "Main account plus the pots above", "total")}
      ${(b.main || 0) < 1 ? `<li class="note">Your main account is empty, so any card payment or subscription that isn't paid from a pot will be declined. Move a little in before one is due.</li>` : ""}
    </ul>`;
    if (aside.length) html += `<p class="pot-group">Set aside, not counted as spending money</p><ul class="pots">
      ${aside.map(x => row(potName(x), x.balance, goalText(x))).join("")}
      ${row("Set aside", sum(aside), "", "total")}</ul>`;
    if (empty) html += `<p class="pot-group">${empty} empty pot${empty > 1 ? "s" : ""} hidden</p>`;
    $("#potsBody").innerHTML = html;
  }

  /* ---------- account ---------- */
  let me = null;
  const PERSON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/></svg>';
  const initials = n => String(n || "").trim().split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join("");
  function renderAcct() {
    const ini = initials(me && me.name);
    for (const el of [$("#acctInit"), $("#acctBig")]) { if (ini) el.textContent = ini; else el.innerHTML = PERSON; }
    $("#acctName").textContent = (me && me.name) || "Your account";
    const b = bank();
    $("#acctSub").textContent = b ? `Connected to ${b.source || "your bank"}` : "No bank connected yet";
    const at = b ? new Date(b.asOf) : null;
    const row = (k, v) => `<li><div><span class="pname">${esc(k)}</span></div><span class="pmeta">${esc(v)}</span></li>`;
    $("#acctRows").innerHTML = [
      b ? row("Bank", b.source || "Connected") : row("Bank", "Not connected"),
      b ? row("Last updated", isoD(at) === today() ? `Today at ${at.toLocaleTimeString("en-GB", {hour: "2-digit", minute: "2-digit"})}` : niceDate(isoD(at))) : "",
      state ? row("Spending money", money(calc().balance)) : "",
      row("Saved in", "Your Claude account")
    ].join("");
  }
  $("#acctBtn").onclick = () => { renderAcct(); $("#acctDlg").showModal(); };
  $("#acctClose").onclick = () => $("#acctDlg").close();
  $("#acctSettings").onclick = () => { $("#acctDlg").close(); openSettings(); };
  renderAcct();

  /* ---------- refresh from Monzo (local connector, Claude desktop app only) ---------- */
  const MONZO = "host:monzo";
  let mcp = null, refreshing = false;
  const MONZO_CAT = {eating_out: "eating", groceries: "groceries", transport: "transport", personal_care: "personal", family: "family"};
  function payloadOf(r) {
    let p = r && r.payload;
    if (typeof p === "string") { try { p = JSON.parse(p); } catch (e) { /* plain text */ } }
    return p;
  }
  function needsAction(p) {
    if (p && typeof p === "object" && !Array.isArray(p)) {
      const st = String(p.status || p.state || "").toLowerCase();
      if (st.includes("sca") || p.waiting_for_sca) return "Approve the request in your Monzo app, then tap Refresh again.";
      if (st.includes("login") || p.needs_login) return "Monzo needs you to log in again. Ask Claude in chat to reconnect Monzo.";
      if (p.error) return String(p.error);
    }
    if (typeof p === "string") return p.slice(0, 160);
    return null;
  }
  function refreshError(e) {
    const code = e && e.code;
    if (code === "server_not_connected" || code === "not_granted" || code === "capability_disabled" || code === "capability_removed")
      return "Refreshing works in the Claude desktop app, where your Monzo connection runs. Open this page there, or ask Claude in chat to refresh.";
    if (code === "not_in_manifest") return "This page isn't allowed to use Monzo. Allow Monzo for it when asked, then try again.";
    if (code === "cancelled") return "Claude asked you to allow the Monzo request and it wasn't allowed. Tap refresh again and choose Allow for each one.";
    if (code === "server_unavailable") return "Monzo didn't answer. Try again in a minute.";
    if (code === "needs_reauth") return "Monzo needs you to log in again. Ask Claude in chat to reconnect Monzo.";
    if (code === "tool_error") return `Monzo said: ${String(e.message || "something went wrong").slice(0, 140)}`;
    return `Couldn't refresh: ${String((e && e.message) || "unknown problem").slice(0, 140)}`;
  }
  async function refreshBank() {
    const b = bank();
    if (refreshing) return;
    if (!b || !state) return toast("Connect your bank first, then this refreshes it.");
    if (!mcp) return toast("Refreshing works in the Claude desktop app, where your Monzo connection runs. Open this page there, or ask Claude in chat to refresh.");
    refreshing = true;
    const btn = $("#refreshBank"); btn.disabled = true; btn.textContent = "Refreshing…";
    $("#syncBtn").classList.add("spin"); $("#syncBtn").setAttribute("aria-busy", "true");
    $("#potsWhen").textContent = "Checking Monzo…";
    try {
      const acc = b.accountId || "";
      const since = new Date(new Date(b.asOf).getTime() - 864e5).toISOString();
      const fresh = {cache: false};
      const balP = payloadOf(await mcp.callTool(MONZO, "monzo_get_balance", {account_id: acc}, fresh));
      let msg = needsAction(balP) || (typeof (balP && balP.balance) !== "number" ? "Monzo didn't send a balance." : null);
      if (msg && typeof (balP && balP.balance) !== "number") throw {friendly: msg};
      const potsP = payloadOf(await mcp.callTool(MONZO, "monzo_list_pots", {}, fresh));
      if (!Array.isArray(potsP)) throw {friendly: needsAction(potsP) || "Monzo didn't send your pots."};
      const txP = payloadOf(await mcp.callTool(MONZO, "monzo_list_transactions", {account_id: acc, since, limit: 100}, fresh));
      const txs = Array.isArray(txP) ? txP : [];

      // pots: keep what each pot is for, add new ones as spending pots
      const old = new Map(b.pots.map(p => [p.id, p]));
      const pots = potsP.filter(p => !p.deleted).map(p => {
        const o = old.get(p.id) || {role: "spend", cats: []};
        return {...o, id: p.id, name: p.name, balance: r2((p.balance || 0) / 100), goal: p.goal_amount ? r2(p.goal_amount / 100) : null};
      });
      const main = r2((balP.balance || 0) / 100);
      const spendMoney = r2(main + pots.filter(p => p.role === "spend").reduce((s, p) => s + p.balance, 0));

      // new card payments and money in, skipping pot moves, declines and card checks
      const known = new Set();
      for (const k in months) for (const it of months[k]) if (it.monzoId) { known.add(it.monzoId); if (it.returnedId) known.add(it.returnedId); }
      const catIds = new Set((state.categories || []).map(c => c.id));
      const stamp = Date.now();
      const add = {};
      let added = 0;
      const decl = JSON.parse(JSON.stringify(state.declines || []));
      const dKey = n => String(n || "").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 24);
      for (const t of txs) {
        if (t && t.id && t.decline_reason && t.amount < 0) {
          const name = String(t.merchant || t.description || "A company").trim().slice(0, 60), key = dKey(name);
          let d = decl.find(x => x.key === key);
          if (!d) { d = {key, name, amount: 0, last: "", count: 0, ids: [], status: "open"}; decl.push(d); }
          if (!d.ids.includes(t.id)) {
            d.ids.push(t.id); d.ids = d.ids.slice(-10); d.count++;
            d.amount = r2(Math.abs(t.amount) / 100); d.last = isoD(new Date(t.created));
            if (d.status === "keep" || d.status === "dismiss") d.status = "open";   // tried again: ask again
          }
          continue;
        }
        if (t && t.id && t.amount < 0 && !t.decline_reason) {
          const d = decl.find(x => x.key === dKey(t.merchant || t.description) && x.status === "cancel");
          if (d) { d.status = "charged"; d.amount = r2(Math.abs(t.amount) / 100); d.last = isoD(new Date(t.created)); }
        }
        if (!t || !t.id || known.has(t.id) || t.decline_reason || !t.amount) continue;
        if (String(t.description || "").startsWith("pot_") || t.category === "savings") continue;
        const date = isoD(new Date(t.created));
        const name = String(t.merchant || t.description || "Monzo").trim().slice(0, 60);
        const amt = r2(Math.abs(t.amount) / 100);
        const sure = t.amount < 0 && catIds.has(MONZO_CAT[t.category]);
        const cat = t.amount < 0 ? (sure ? MONZO_CAT[t.category] : "other") : "monzo-in";
        const row = {id: uid6(), type: t.amount < 0 ? "expense" : "income", amount: amt, cat, note: name, date, created: stamp - 1, monzoId: t.id};
        if (t.amount < 0 && !sure) row.needsCat = true;
        if (t.amount > 0) {
          // pay that matches an income source counts as that payday arriving
          const src = incomes().find(x => name.toLowerCase().includes(x.name.split(" ")[0].toLowerCase()));
          const due = src && occurrences(src, addDays(date, -4), addDays(date, 4))[0];
          if (src && due && !isReceived(src.id, due)) Object.assign(row, {cat: src.id, srcId: src.id, forDate: due, note: ""});
        }
        (add[date.slice(0, 7)] = add[date.slice(0, 7)] || []).push(row);
        added++;
      }
      for (const k in add) writeMonth(k, items => items.concat(add[k]));
      // the bank's numbers are the truth: re-anchor spending money to them
      saveState({...state, balance: spendMoney, balanceSetAt: stamp, balanceAsOf: today(),
        bank: {...b, main, pots, asOf: new Date(stamp).toISOString()},
        declines: decl.filter(x => x.status !== "done" && x.last >= addDays(today(), -45))});
      toast(added ? `Updated from Monzo. ${added} new payment${added > 1 ? "s" : ""} added` : "Updated from Monzo. No new payments", true);
    } catch (e) {
      toast(e && e.friendly ? e.friendly : refreshError(e));
    } finally {
      refreshing = false; btn.disabled = false; btn.textContent = "Refresh"; renderPots();
      $("#syncBtn").classList.remove("spin"); $("#syncBtn").removeAttribute("aria-busy");
    }
  }
  $("#refreshBank").onclick = refreshBank;
  $("#syncBtn").onclick = refreshBank;

  /* ---------- wallet: our card in front, the bank's card tucked behind (Apple Wallet style) ---------- */
  let hideBal = false;
  try { hideBal = localStorage.getItem("hideBal") === "1"; } catch (e) {}
  const EYE = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>';
  const EYE_OFF = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 3l18 18"/><path d="M10.6 5.1A10.4 10.4 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4.1M6.6 6.6C3.9 8.3 2 12 2 12s3.6 7 10 7a9.7 9.7 0 0 0 5.4-1.6"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>';
  // with no label (the bank card), it's just the number, which keeps the stack compact
  const balBtn = (label, amt) => `<button type="button" class="bal-btn" data-bal aria-pressed="${hideBal}" aria-label="${label || "Balance"} ${hideBal ? "hidden" : money(amt)}. Tap to ${hideBal ? "show" : "hide"}">${label ? `<span class="bal-lab">${esc(label)}${hideBal ? EYE_OFF : EYE}</span>` : ""}<span class="bal-amt num${hideBal ? " blur" : ""}">${money(amt)}</span></button>`;
  function renderBankCard(c, total) {
    const card = $("#bankCard"), w = $("#wallet"), b = bank();
    if (!b) { card.hidden = true; w.classList.remove("has-peek", "swap"); return; }
    card.hidden = false; w.classList.add("has-peek");
    const aside = b.pots.filter(p => p.role !== "spend").reduce((s, p) => s + (p.balance || 0), 0);
    const at = new Date(b.asOf);
    card.innerHTML = `
      <div class="wc-row">${balBtn("", total)}<span class="wc-mono" role="img" aria-label="${esc(b.source || "Bank")}">${esc((b.source || "B").trim().charAt(0).toUpperCase())}</span></div>
      <div class="wc-foot">
        <div><span class="bal-lab">Spending money</span><b class="num">${money(c.balance)}</b></div>
        <div><span class="bal-lab">Set aside</span><b class="num">${money(r2(aside))}</b></div>
        <div><span class="bal-lab">Updated</span><b>${isoD(at) === today() ? at.toLocaleTimeString("en-GB", {hour: "2-digit", minute: "2-digit"}) : niceDate(isoD(at))}</b></div>
      </div>`;
  }
  document.addEventListener("click", e => {
    const bb = e.target.closest("[data-bal]");
    const w = $("#wallet");
    // a card tucked behind comes forward first; its balance only toggles once it's in front
    if (bb && ((bb.closest("#bankCard") && !w.classList.contains("swap")) || (bb.closest("#hero") && w.classList.contains("swap")))) {
      e.stopPropagation(); w.classList.toggle("swap", !!bb.closest("#bankCard")); return;
    }
    if (bb) {
      e.stopPropagation();
      hideBal = !hideBal;
      try { localStorage.setItem("hideBal", hideBal ? "1" : "0"); } catch (er) {}
      render();
      return;
    }
    if (e.target.closest("#bankCard")) $("#wallet").classList.add("swap");
  }, true);
  $("#bankCard").addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); $("#wallet").classList.add("swap"); } });
  /* ---------- looking back at other days ---------- */
  let viewDay = null;   // null means today
  function daySummary(d) {
    subscribeMonth(d.slice(0, 7));
    const items = (months[d.slice(0, 7)] || []).filter(it => it.date === d && it.type === "expense");
    const billIds = new Set((state.categories || []).filter(x => x.fixed).map(x => x.id));
    return {spent: r2(items.reduce((s, it) => s + it.amount, 0)), count: items.length,
      bills: r2(items.filter(it => it.billId || billIds.has(it.cat)).reduce((s, it) => s + it.amount, 0))};
  }
  function goDay(d) {
    const t = today();
    viewDay = !d || d >= t ? null : d;
    if (view !== "month") setView("month"); else render();
  }
  $("#dayPrev").onclick = () => goDay(addDays(viewDay || today(), -1));
  $("#dayNext").onclick = () => goDay(addDays(viewDay || today(), 1));
  let calMonth = null;
  function renderCal() {
    const t = today(), sel = viewDay || t, key = calMonth;
    subscribeMonth(key);
    const items = (months[key] || []).filter(it => it.type === "expense");
    const per = {};
    for (const it of items) per[it.date] = r2((per[it.date] || 0) + it.amount);
    const first = parseD(key + "-01"), dim = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
    const lead = (first.getDay() + 6) % 7;   // weeks start on Monday
    $("#calTitle").textContent = first.toLocaleDateString("en-GB", {month: "long", year: "numeric"});
    $("#calTotal").textContent = `Spent ${money(r2(Object.values(per).reduce((s, v) => s + v, 0)))} this month so far. Tap a day to see it.`;
    let html = ["M", "T", "W", "T", "F", "S", "S"].map(d => `<span class="cal-dow" aria-hidden="true">${d}</span>`).join("");
    html += "<span></span>".repeat(lead);
    for (let i = 1; i <= dim; i++) {
      const d = `${key}-${pad(i)}`, fut = d > t, amt = per[d];
      html += `<button type="button" class="cal-day${d === t ? " today" : ""}${d === sel ? " sel" : ""}${amt ? " has" : ""}" data-day="${d}" ${fut ? 'aria-disabled="true" tabindex="-1"' : ""} aria-label="${niceDate(d)}${amt ? `, spent ${money(amt)}` : ""}"><b>${i}</b><small>${fut ? "" : amt ? "£" + Math.round(amt) : "–"}</small></button>`;
    }
    $("#calGrid").innerHTML = html;
    $("#calNext").disabled = key >= t.slice(0, 7);
    $("#calPrev").disabled = key <= addMonths(t.slice(0, 7), -11);
  }
  $("#calBtn").onclick = () => { calMonth = (viewDay || today()).slice(0, 7); renderCal(); $("#calDlg").showModal(); };
  $("#calPrev").onclick = () => { calMonth = addMonths(calMonth, -1); renderCal(); };
  $("#calNext").onclick = () => { calMonth = addMonths(calMonth, 1); renderCal(); };
  $("#calClose").onclick = () => $("#calDlg").close();
  $("#calToday").onclick = () => { $("#calDlg").close(); goDay(null); };
  $("#calGrid").addEventListener("click", e => {
    const b = e.target.closest(".cal-day"); if (!b || b.getAttribute("aria-disabled") === "true") return;
    $("#calDlg").close(); goDay(b.dataset.day);
  });
  let heroFlipped = false;
  // count up to the daily number when it first appears, and from the old figure to the new one when it changes
  let heroShown = null, heroAnim = 0, heroCounting = null;
  function countHero(target) {
    const el = $("#hero .front .big"); if (!el) return;
    const from = heroShown == null ? 0 : heroShown;
    heroShown = target;
    if (from === target || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const show = v => {
      // look the elements up each frame: a re-render can replace them mid-count
      const int = $("#hero .front .int"), pen = $("#hero .front .pence"); if (!int || !pen) return;
      const a = Math.abs(v), w = Math.floor(a + 1e-9), p = Math.round((a - w) * 100) % 100;
      int.textContent = `${v < 0 ? "−" : ""}£${w.toLocaleString("en-GB")}`;
      pen.textContent = `.${pad(p)}`;
    };
    const id = ++heroAnim, t0 = performance.now(), dur = 900;
    let last = from;
    heroCounting = () => show(last);
    const ease = t => 1 - Math.pow(1 - t, 3);
    const step = now => {
      if (id !== heroAnim) return;
      const t = Math.min(1, (now - t0) / dur);
      last = from + (target - from) * ease(t);
      show(last);
      if (t < 1) requestAnimationFrame(step); else { heroCounting = null; show(target); }
    };
    show(from); requestAnimationFrame(step);
  }
  function fitBig() {
    document.querySelectorAll("#hero .big").forEach(el => {
      el.style.fontSize = "";
      let px = parseFloat(getComputedStyle(el).fontSize);
      while (el.scrollWidth > el.clientWidth + 1 && px > 40) { px -= 2; el.style.fontSize = px + "px"; }
    });
  }
  // the card takes the height of whichever side is showing
  function sizeFlip() {
    const f = $("#hero .flip"); if (!f) return;
    f.style.height = f.querySelector(".front").offsetHeight + "px";
    // if the explanation would spill over, ease the text down a touch rather than grow the card
    const back = f.querySelector(".back"), line = back && back.querySelector(".why-line");
    if (line) { line.style.fontSize = ""; let px = parseFloat(getComputedStyle(line).fontSize);
      while (back.scrollHeight > back.clientHeight + 1 && px > 12) { px -= .5; line.style.fontSize = px + "px"; } }
  }
  addEventListener("resize", () => sizeFlip());
  let chocTimers = [];
  // the animation's current step lives here, so a re-render keeps its place and every flip starts it fresh
  let chocStep = 0;
  function setChoc(k) {
    chocStep = k;
    const ch = $("#hero .choc"), back = $("#hero .back"); if (!ch || !back) return;
    ch.classList.remove("s0", "sa", "s1", "s2", "s3", "s4"); ch.classList.add("s" + k);
    back.classList.toggle("intro", k === 0 || k === "a");
    back.classList.toggle("asked", k !== 0);
  }
  function resetChoc() {
    chocTimers.forEach(clearTimeout); chocTimers = [];
    const back = $("#hero .back"); if (!back) return;
    back.classList.add("snap");             // jump back to the start with no transitions
    setChoc(0);
    void back.offsetWidth;
    back.classList.remove("snap");
  }
  function playChoc() {
    resetChoc();
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return setChoc(4);
    // 1) the question on its own, 2) the idea on its own, 3) the bar tells the story
    // each step stays up for at least 1.5s, longer if its words need more time to read (about 4–5 words a second, plus the movement)
    const words = sel => { const el = $(sel); return el ? el.textContent.trim().split(/\s+/).length : 0; };
    const hold = sel => Math.max(1500, 500 + words(sel) * 220);
    const plan = [["a", 1500], [1, hold("#hero .why-intro .l2")], [2, hold("#hero .choc-cap .c1")], [3, hold("#hero .choc-cap .c2")], [4, hold("#hero .choc-cap .c3")]];
    let t = 0;
    plan.forEach(([k, d]) => { t += d; chocTimers.push(setTimeout(() => setChoc(k), t)); });
  }
  function flipHero() {
    const h = $("#hero"); if (!h.classList.contains("flippable") || h.classList.contains("noflip")) return;
    heroFlipped = !heroFlipped;
    h.classList.toggle("flipped", heroFlipped);
    h.querySelector(".front").setAttribute("aria-hidden", heroFlipped);
    h.querySelector(".back").setAttribute("aria-hidden", !heroFlipped);
    sizeFlip();
    if (heroFlipped) playChoc(); else resetChoc();
    h.setAttribute("aria-label", heroFlipped ? "Days until payday. Tap to show today's amount." : "Safe to spend today. Tap to show days until payday.");
  }
  $("#hero").addEventListener("click", e => {
    if ($("#wallet").classList.contains("swap")) { $("#wallet").classList.remove("swap"); return; }
    if (!e.target.closest("button, a, input, form")) flipHero();
  });
  $("#hero").addEventListener("keydown", e => { if ((e.key === "Enter" || e.key === " ") && e.target === $("#hero")) { e.preventDefault(); flipHero(); } });
  addEventListener("resize", () => fitBig());

  /* ---------- bills ---------- */
  const bills = () => (state && state.bills) || [];
  const BILL_FREQ = {monthly: "Every month", weekly: "Every week", fortnightly: "Every 2 weeks", fourweekly: "Every 4 weeks", quarterly: "Every 3 months", yearly: "Every year"};
  const PER_MONTH = {monthly: 1, weekly: 52/12, fortnightly: 26/12, fourweekly: 13/12, quarterly: 1/3, yearly: 1/12};
  const METHOD = {dd: "Direct debit", card: "Card", transfer: "I send it myself"};
  const METHOD_META = {dd: "direct debit", card: "card", transfer: "you send it"};
  const COMMON_BILLS = ["Rent", "Council tax", "Energy", "Water", "Phone", "Broadband", "Gym", "TV licence", "Insurance", "Car finance", "Loan"];
  const ord = n => n + ((n % 100 >= 11 && n % 100 <= 13) ? "th" : ({1: "st", 2: "nd", 3: "rd"}[n % 10] || "th"));
  function workingAfter(d) {
    const x = new Date(d);
    while (x.getDay() === 0 || x.getDay() === 6 || BANK_HOLIDAYS.has(isoD(x))) x.setDate(x.getDate() + 1);
    return x;
  }
  // bills move LATER on weekends and bank holidays (pay moves earlier)
  function billDates(b, from, to) {
    const out = [], F = parseD(from), T = parseD(to);
    if (b.freq === "monthly") {
      for (let i = -1; i < 40; i++) {
        const base = new Date(F.getFullYear(), F.getMonth() + i, 1), last = new Date(base.getFullYear(), base.getMonth() + 1, 0);
        const d = b.day === "last" ? workingBefore(last) : workingAfter(new Date(base.getFullYear(), base.getMonth(), Math.min(+b.day || 1, last.getDate())));
        if (d > T) break;
        if (d >= F) out.push(isoD(d));
      }
      return out;
    }
    if (!b.date) return out;
    const A = parseD(b.date), step = {weekly: 7, fortnightly: 14, fourweekly: 28}[b.freq];
    if (step) {
      const n = Math.floor((F - A) / 864e5 / step) - 1;
      for (let i = n; i < n + 600; i++) {
        const d = new Date(A); d.setDate(d.getDate() + i * step);
        const w = workingAfter(d);
        if (w > T) break;
        if (w >= F) out.push(isoD(w));
      }
      return out;
    }
    const m = {quarterly: 3, yearly: 12}[b.freq] || 1;
    const i0 = Math.floor(((F.getFullYear() - A.getFullYear()) * 12 + F.getMonth() - A.getMonth()) / m) - 1;
    for (let i = i0; i < i0 + 200; i++) {
      const base = new Date(A.getFullYear(), A.getMonth() + i * m, 1), last = new Date(base.getFullYear(), base.getMonth() + 1, 0);
      const w = workingAfter(new Date(base.getFullYear(), base.getMonth(), Math.min(A.getDate(), last.getDate())));
      if (w > T) break;
      if (w >= F) out.push(isoD(w));
    }
    return out;
  }
  const nextBill = b => billDates(b, today(), addDays(today(), 400))[0] || null;
  function billPaid(b, d) {
    for (const k in months) for (const it of months[k]) {
      if (it.billId === b.id && it.forDate === d) return true;
      if (b.cat && it.type === "expense" && it.cat === b.cat && it.date >= addDays(d, -7) && it.date <= addDays(d, 3)) return true;
    }
    return false;
  }
  const billMonthly = b => (b.amount || 0) * (PER_MONTH[b.freq] || 1);
  function billSource(b) {
    const f = b.from || {};
    if (f.kind === "pot") { const p = bank() && bank().pots.find(x => x.id === f.id); return p ? potName(p) : (f.name || "a pot"); }
    if (f.kind === "other") return f.name || "another bank";
    return "main account";
  }
  function billRow(b) {
    const n = nextBill(b);
    const meta = `${n ? `Next ${niceDate(n)}` : BILL_FREQ[b.freq]}. From ${billSource(b)}${b.method ? `, ${METHOD_META[b.method]}` : ""}`;
    return `<li data-edit-bill="${esc(b.id)}" tabindex="0" role="button"><div><span class="pname">${esc(b.name)}</span><span class="pmeta">${esc(meta)}</span></div><span class="pamt num">${b.varies ? "About " : ""}${money(b.amount || 0)}</span></li>`;
  }
  function renderBills(c) {
    const body = $("#billsBody");
    if (!state) { body.innerHTML = ""; $("#billsSum").textContent = ""; $("#addBillBtn").hidden = true; return; }
    const list = bills();
    $("#addBillBtn").hidden = !list.length;
    if (!list.length) {
      $("#billsSum").textContent = "";
      body.innerHTML = `<p class="muted" style="margin:0 0 var(--s4)">Tell the tracker what goes out regularly, like rent or your phone. It holds that money back before showing what you can spend.</p>
        <button class="btn primary" type="button" data-bill-wiz>Set up your bills</button>`;
      return;
    }
    $("#billsSum").textContent = `${money(list.reduce((s, b) => s + billMonthly(b), 0))} a month`;
    const sorted = [...list].sort((x, y) => (nextBill(x) || "9") < (nextBill(y) || "9") ? -1 : 1);
    const before = (c.billsDue || []).reduce((s, x) => s + (x.b.amount || 0), 0);
    body.innerHTML = `<ul class="pots bills">${sorted.map(billRow).join("")}</ul>
      ${c.payday ? `<p class="pot-group">${before ? `${money(before)} is due before payday on ${niceDate(c.payday)}, so it's held back from your spending money.` : `Nothing is due before payday on ${niceDate(c.payday)}.`}</p>` : ""}`;
  }

  /* ---------- "What was this?" for payments the app can't place ---------- */
  function unsorted() {
    const out = [];
    for (const k in months) for (const it of months[k]) if (it.needsCat && it.type === "expense") out.push(it);
    return out.sort((a, b) => a.date.localeCompare(b.date));
  }
  function billFor(b, date) {
    // count it towards the next one due on or after the payment (past ones are no longer held back anyway)
    const ds = billDates(b, date, addDays(date, 45));
    return ds.find(d => !billPaid(b, d)) || ds[0] || null;
  }
  function renderAsk(c) {
    const box = $("#askTx");
    if (!state || !db) { box.innerHTML = ""; return; }
    const list = unsorted();
    if (!list.length) { box.innerHTML = ""; box.dataset.key = ""; return; }
    const it = list[0];
    if (box.dataset.key === it.id + list.length && box.innerHTML) return;
    box.dataset.key = it.id + list.length;
    // figure: the most likely answer (a bill for the same amount) is offered first, on its own
    const guess = bills().find(b => Math.abs((b.amount || 0) - it.amount) < 0.5);
    const billChips = bills().filter(b => b !== guess).map(b => `<button type="button" class="chip" data-ask-bill="${esc(b.id)}">${esc(b.name)}</button>`).join("");
    const catChips = c.cats.filter(x => !x.fixed || !bills().some(b => b.cat === x.id)).map(x => `<button type="button" class="chip" data-ask-cat="${esc(x.id)}">${esc(x.name)}</button>`).join("");
    box.innerHTML = `<details class="panel checkin ask todo"><summary><span class="todo-dot" aria-hidden="true"></span><span class="todo-txt">${list.length > 1 ? `${list.length} payments to sort` : "1 payment to sort"}<small>${money(it.amount)} to ${esc(it.note || "unknown")}</small></span></summary>
      <div class="ask-body">
        <h2>What was ${money(it.amount)} to ${esc(it.note || "this payment")}?</h2>
        <p class="ask-when">${niceDate(it.date)}</p>
        ${guess ? `<button type="button" class="chip suggest" data-ask-bill="${esc(guess.id)}">It's ${esc(guess.name)}</button>` : ""}
        ${billChips ? `<div class="ask-group"><p class="ask-label">${guess ? "Another bill" : "Bills"}</p><div class="chips">${billChips}</div></div>` : ""}
        <div class="ask-group"><p class="ask-label">Spending</p><div class="chips">${catChips}</div></div>
        <button type="button" class="link-btn ask-note-btn" data-note-toggle>Add a note</button>
        <label class="field" id="askNoteWrap" hidden><span>Note</span><input id="askNote" placeholder="e.g. Shoes, haircut, deposit"></label>
      </div>
    </details>`;
    const nt = box.querySelector("[data-note-toggle]");
    if (nt) nt.onclick = () => { nt.hidden = true; $("#askNoteWrap").hidden = false; $("#askNote").focus(); };
    box.querySelectorAll("[data-ask-bill],[data-ask-cat]").forEach(btn => btn.onclick = () => {
      const note = ($("#askNote").value || "").trim().slice(0, 60);
      const patch = {needsCat: false};
      let msg;
      if (btn.dataset.askBill) {
        const b = bills().find(x => x.id === btn.dataset.askBill), d = b && billFor(b, it.date);
        Object.assign(patch, {cat: b.cat || "other", billId: b.id, forDate: d});
        msg = d ? `${b.name} marked paid for ${niceDate(d)}. It's no longer held back` : `Filed under ${b.name}`;
      } else {
        patch.cat = btn.dataset.askCat;
        msg = `Filed under ${(c.cats.find(x => x.id === patch.cat) || {}).name}`;
      }
      if (note) patch.note = `${note} (${it.note})`;
      box.dataset.key = "";
      writeMonth(it.date.slice(0, 7), items => items.map(x => x.id === it.id ? {...x, ...patch} : x));
      toast(msg, true);
    });
  }

  /* ---------- where your money is: one bar split by group, like iPhone Storage ---------- */
  function renderSplit(c) {
    const box = $("#moneySplit"); if (!box) return;
    if (!state || c.balance == null || !c.payday) { box.innerHTML = ""; return; }
    const saved = bank() ? r2(bank().pots.filter(p => p.role !== "spend").reduce((s2, p) => s2 + (p.balance || 0), 0)) : 0;
    const total = r2(c.balance + saved + manualTotalSafe());
    const billsA = r2(Math.max(0, Math.min(c.billsLeft, Math.max(c.balance, 0))));
    const everyA = r2(Math.max(0, Math.min(c.everydayLeft, Math.max(c.balance - billsA, 0))));
    const freeA = r2(Math.max(0, c.balance - billsA - everyA));
    const short = r2(Math.max(0, c.billsLeft + c.everydayLeft - c.balance));
    const parts = [["bills", "Bills", billsA], ["save", "Savings", saved], ["every", "Everyday", everyA], ["free", "Free", freeA]];
    const sum = parts.reduce((s2, p) => s2 + p[2], 0) || 1;
    box.innerHTML = `<div class="split" aria-label="Where your money is">
      <div class="split-head"><span>Where your ${hideBal ? "money" : money(total)} is</span>${short ? `<span class="split-short">${money(short)} short</span>` : ""}</div>
      <div class="split-bar" role="img" aria-label="${parts.map(p => `${p[1]} ${money(p[2])}`).join(", ")}">${parts.filter(p => p[2] > 0).map(p => `<i class="sg-${p[0]}" style="flex:${p[2] / sum}"></i>`).join("")}</div>
      <div class="split-key num">${parts.map(p => `<span><i class="sg-${p[0]}"></i>${p[1]}<b class="${hideBal ? "blur" : ""}">${money(p[2])}</b></span>`).join("")}</div>
    </div>`;
  }
  const manualTotalSafe = () => (state && Array.isArray(state.manualCards)) ? state.manualCards.reduce((s2, m) => s2 + (+m.balance || 0), 0) : 0;

  /* ---------- short for bills and everyday: say so, and how to fix it ---------- */
  function renderShort(c) {
    const box = $("#shortTodo");
    if (!state || !c.short || viewDay) { box.innerHTML = ""; box.dataset.key = ""; return; }
    const key = `${c.short}|${c.savings}`;
    if (box.dataset.key === key && box.innerHTML) return;
    box.dataset.key = key;
    const cover = Math.min(c.short, c.savings);
    box.innerHTML = `<details class="panel checkin todo"><summary><span class="todo-dot" aria-hidden="true"></span><span class="todo-txt">${cover >= c.short ? "Cover bills from savings" : "Short for bills and everyday"}<small>${money(c.short)} short before payday</small></span></summary>
      <h2>You need ${money(c.short)} more</h2>
      <p class="muted">You have ${money(c.balance)} to spend, but ${c.everydayLeft ? `bills (${money(c.billsLeft)}) and everyday (${money(c.everydayLeft)}) need` : "bills need"} ${money(c.need)} before payday.</p>
      ${c.savings > 0 ? `<p>${cover >= c.short ? `Bills and everyday come first. Move <b>${money(c.short)}</b> from savings into your spending money and you're covered.` : `Moving all your savings (${money(c.savings)}) would cover part of it. The other ${money(r2(c.short - c.savings))} would need cutting from everyday amounts.`}</p>` : `<p>Lower an everyday amount in Plan, or wait until payday for the rest.</p>`}
      <div class="row-btns"><button class="btn primary" type="button" id="shortMoved">I've moved it</button><button class="btn ghost" type="button" data-plan>Change everyday</button></div>
    </details>`;
    $("#shortMoved").onclick = () => { if (mcp) refreshBank(); else toast("Once it's moved, tap refresh in the desktop app so the app sees it."); };
  }

  /* ---------- declined payments: keep it or cancel it ---------- */
  function renderDeclines() {
    const box = $("#declineTodo");
    const list = (state && !viewDay) ? (state.declines || []).filter(d => d.status === "open" || d.status === "charged") : [];
    const key = list.map(d => d.key + d.status + d.count).join("|");
    if (box.dataset.key === key && box.innerHTML) return;
    box.dataset.key = key;
    box.innerHTML = list.map(d => d.status === "charged" ? `
      <details class="panel checkin todo"><summary><span class="todo-dot" aria-hidden="true"></span><span class="todo-txt">${esc(d.name)} charged you after you cancelled<small>${money(d.amount)} on ${niceDate(d.last)}</small></span></summary>
        <h2>${esc(d.name)} took ${money(d.amount)}</h2>
        <p class="muted">You said you'd cancel this. If you did, ask ${esc(d.name)} for a refund. If the cancel didn't go through, cancel it again where you signed up.</p>
        <div class="row-btns"><button class="btn primary" type="button" data-dec="done" data-key="${esc(d.key)}">Sorted</button><button class="btn ghost" type="button" data-dec="keep" data-key="${esc(d.key)}">Actually, keep it</button></div>
      </details>` : `
      <details class="panel checkin todo"><summary><span class="todo-dot" aria-hidden="true"></span><span class="todo-txt">${esc(d.name)} tried to take ${money(d.amount)}<small>Declined${d.count > 1 ? ` ${d.count} times` : ""}, last on ${niceDate(d.last)}</small></span></summary>
        <h2>Keep paying ${esc(d.name)}?</h2>
        <p class="muted">There wasn't enough in your main account, so it didn't go through.</p>
        <div class="row-btns"><button class="btn primary" type="button" data-dec="keep" data-key="${esc(d.key)}">Keep it</button><button class="btn ghost" type="button" data-dec="cancel" data-key="${esc(d.key)}">Cancel it</button><button class="btn ghost" type="button" data-dec="dismiss" data-key="${esc(d.key)}">Not sure yet</button></div>
      </details>`).join("");
  }
  $("#declineTodo").addEventListener("click", e => {
    const b2 = e.target.closest("[data-dec]"); if (!b2) return;
    const d = (state.declines || []).find(x => x.key === b2.dataset.key); if (!d) return;
    const act = b2.dataset.dec;
    const apple = /apple|itunes/i.test(d.name);
    saveState({...state, declines: (state.declines || []).map(x => x.key === d.key ? {...x, status: act === "dismiss" ? "dismiss" : act} : x)});
    if (act === "keep") toast(`Move ${money(d.amount)} into your main account so ${d.name}'s next try goes through`, true);
    else if (act === "cancel") toast(apple ? `Cancel it on your iPhone: Settings, your name, then Subscriptions. I'll tell you if ${d.name} charges you again` : `Cancel it where you signed up. I'll tell you if ${d.name} charges you again`, true);
    else if (act === "done") toast("Marked as sorted", true);
    else toast(`I'll ask again if ${d.name} tries again`);
  });

  /* ---------- everyday: Day tab at a glance ---------- */
  function renderEveryday(c) {
    const box = $("#everydayRow");
    if (!state || c.balance == null || viewDay) { box.innerHTML = ""; return; }
    if (!c.everyday.length) {
      box.innerHTML = `<div class="panel ev-row"><div class="panel-head"><h2>Everyday</h2><button class="btn ghost small" type="button" data-plan>Plan</button></div><p class="muted" style="margin:0">Set what you spend on every month, like groceries or coffee, and your daily number shows what's truly free.</p></div>`;
      return;
    }
    box.innerHTML = `<div class="panel ev-row"><div class="panel-head"><h2>Everyday</h2><button class="btn ghost small" type="button" data-plan>Plan</button></div>
      <div class="ev-chips">${c.everyday.map(e => `<span class="ev-chip${e.left < 0 ? " over" : ""}"><span>${esc(e.x.name)}</span><b class="num">${e.left < 0 ? `${money(-e.left)} over` : `${money(e.left)} left`}</b></span>`).join("")}</div></div>`;
  }

  /* ---------- plan your month: groups, everyday amounts, savings, then your free money ---------- */
  let plan = null;
  function openPlan() {
    if (!state) return toast("Finish setting up first.");
    const billCats = new Set(bills().map(b => b.cat).filter(Boolean));
    plan = {step: "groups", save: state.saveMonthly ?? "", cats: JSON.parse(JSON.stringify(state.categories || [])).map(x => ({...x, group: billCats.has(x.id) || x.fixed ? "bills" : (x.group || ((x.budget || 0) > 0 ? "everyday" : "free"))})), adding: ""};
    drawPlan(); $("#planDlg").showModal();
  }
  function lastCycleSpend() {
    const t = today(), from = addDays(cycleStart(t), -31), to = addDays(cycleStart(t), -1), out = {};
    for (const k in months) for (const it of months[k]) if (it.type === "expense" && it.date >= from && it.date <= to) out[it.cat] = (out[it.cat] || 0) + it.amount;
    return out;
  }
  function planNumbers() {
    const income = r2(incomes().filter(x => x.freq !== "oneoff").reduce((s, x) => s + perMonth(x), 0));
    const billsM = r2(bills().reduce((s, b) => s + billMonthly(b), 0) || plan.cats.filter(x => x.group === "bills").reduce((s, x) => s + (x.budget || 0), 0));
    const every = r2(plan.cats.filter(x => x.group === "everyday").reduce((s, x) => s + (+x.budget || 0), 0));
    const save = r2(+plan.save || 0);
    return {income, billsM, every, save, free: r2(income - billsM - save - every)};
  }
  function capturePlan() {
    if (!plan) return;
    document.querySelectorAll("#planBody [data-amt]").forEach(inp => { const x = plan.cats.find(k => k.id === inp.dataset.amt); if (x) { const v = num(inp.value); x.budget = Number.isNaN(v) ? 0 : r2(v); } });
    const sv = $("#planSave"); if (sv) plan.save = sv.value;
    const ad = $("#planAdd"); if (ad) plan.adding = ad.value;
  }
  function drawPlan() {
    const body = $("#planBody"), back = $("#planBack"), next = $("#planNext");
    const steps = ["groups", "amounts", "savings", "summary"], at = steps.indexOf(plan.step);
    const dots = `<div class="pl-dots" aria-label="Step ${at + 1} of 4">${steps.map((_, k) => `<i${k <= at ? ' class="on"' : ""}></i>`).join("")}</div>`;
    back.textContent = plan.step === "groups" ? "Not now" : "Back";
    if (plan.step === "groups") {
      const bill = plan.cats.filter(x => x.group === "bills"), ev = plan.cats.filter(x => x.group === "everyday"), fr = plan.cats.filter(x => x.group === "free");
      const chip = (x, to) => `<button type="button" class="pl-chip" data-move="${esc(x.id)}" data-to="${to}" aria-label="${esc(x.name)}. Move to ${to === "free" ? "Free" : "Everyday"}">${esc(x.name)}</button>`;
      body.innerHTML = `${dots}
        <h2 id="planTitle" class="pl-title">Where does your money go?</h2>
        <p class="pl-hint">Tap a thing to move it between Everyday and Free.</p>
        <section class="pl-group ev" aria-label="Everyday">
          <div class="pl-head"><span class="pl-ic" aria-hidden="true">🛒</span><div><b>Everyday</b><span>You'll buy it anyway, but you choose how much. Like food or coffee.</span></div></div>
          <div class="pl-chips">${ev.map(x => chip(x, "free")).join("") || '<span class="pl-empty">Nothing yet</span>'}</div>
          <div class="pl-add"><input id="planAdd" placeholder="Add one, e.g. Coffee" value="${esc(plan.adding)}" aria-label="Add an everyday thing"><button type="button" data-add-cat>Add</button></div>
        </section>
        <section class="pl-group fr" aria-label="Free">
          <div class="pl-head"><span class="pl-ic" aria-hidden="true">🎈</span><div><b>Free</b><span>Fun money. Whatever's left over is yours to spend.</span></div></div>
          <div class="pl-chips">${fr.map(x => chip(x, "everyday")).join("") || '<span class="pl-empty">Nothing here</span>'}</div>
        </section>
        ${bill.length ? `<section class="pl-group bl" aria-label="Bills">
          <div class="pl-head"><span class="pl-ic" aria-hidden="true">🧾</span><div><b>Bills</b><span>Must pay, same time every month. Like rent. Set up separately.</span></div></div>
          <p class="pl-list">${bill.map(x => esc(x.name)).join(" · ")}</p>
        </section>` : ""}`;
      next.textContent = "Next";
      return;
    }
    if (plan.step === "amounts") {
      const ev = plan.cats.filter(x => x.group === "everyday"), last = lastCycleSpend();
      const total = r2(ev.reduce((s2, x) => s2 + (+x.budget || 0), 0));
      body.innerHTML = `${dots}
        <h2 id="planTitle" class="pl-title">How much each month?</h2>
        <p class="pl-hint">${ev.length ? "Pick what feels right. You can change it any time." : "Nothing is in Everyday. Go back to add some, or carry on."}</p>
        ${ev.length ? `<section class="pl-group ev">
          <ul class="pl-amts">${ev.map(x => `<li><label for="amt-${esc(x.id)}"><b>${esc(x.name)}</b>${last[x.id] ? `<span>Last month ${money(last[x.id])}</span>` : ""}</label>
            <span class="pl-money"><em>£</em><input id="amt-${esc(x.id)}" data-amt="${esc(x.id)}" inputmode="decimal" placeholder="0" value="${x.budget ? x.budget : (last[x.id] ? Math.round(last[x.id]) : "")}"></span></li>`).join("")}</ul>
          <div class="pl-total"><span>Everyday each month</span><b class="num" id="plTotal">${money(total)}</b></div>
        </section>` : ""}`;
      next.textContent = "Next";
      return;
    }
    if (plan.step === "savings") {
      const room = r2(planNumbers().income - planNumbers().billsM - planNumbers().every);
      const picks = room > 0 ? [["10%", .1], ["20%", .2], ["Half", .5]].map(([k, f]) => [k, Math.floor(room * f / 5) * 5]).filter(p2 => p2[1] > 0) : [];
      body.innerHTML = `${dots}
        <h2 id="planTitle" class="pl-title">How much do you save?</h2>
        <div class="pl-room"><span>Left after bills and everyday</span><b class="num">${money(room)}</b><small>${room > 0 ? "This is the most you could save each month." : "Bills and everyday already use all your pay, so there's nothing left to save yet."}</small></div>
        <section class="pl-group sv">
          <div class="pl-head"><span class="pl-ic" aria-hidden="true">🐷</span><div><b>Savings</b><span>Money you hide away for later, like a piggy bank. Put it away on payday so you never miss it.</span></div></div>
          ${picks.length ? `<div class="pl-picks">${picks.map(([k, v]) => `<button type="button" class="pl-pick" data-pick-save="${v}">${k}<b class="num">${money(v)}</b></button>`).join("")}</div>` : ""}
          <label class="pl-big"><span>Each month</span><span class="pl-money big"><em>£</em><input id="planSave" inputmode="decimal" placeholder="0" value="${esc(plan.save)}"></span></label>
          <p class="pl-left num" id="plLeft"></p>
        </section>`;
      updateSaveLeft(room);
      next.textContent = "See my free money";
      return;
    }
    const n = planNumbers(), fAbs = Math.abs(n.free), fw = Math.floor(fAbs), fp = Math.round((fAbs - fw) * 100) % 100;
    const row = (ic, k, v, sign) => `<li><span><i aria-hidden="true">${ic}</i>${k}</span><b class="num">${sign}${money(v)}</b></li>`;
    body.innerHTML = `${dots}
      <div class="plan-free"><span>${n.free >= 0 ? "Your free money each month" : "You'd be short each month"}</span>
        <p class="mc-big num"><span class="int">${n.free < 0 ? "−" : ""}£${fw.toLocaleString("en-GB")}</span><span class="pence">.${pad(fp)}</span></p>
        <small>${n.free >= 0 ? `About ${money(r2(n.free / 30))} a day for whatever you like` : "Lower an everyday amount or your savings to balance it"}</small></div>
      <p class="pl-hint" style="margin-top:var(--s4)">How it's worked out</p>
      <ul class="pl-sum">${row("💷", "Pay you can count on", n.income, "")}${row("🧾", "Bills", n.billsM, "−")}${row("🐷", "Savings", n.save, "−")}${row("🛒", "Everyday", n.every, "−")}</ul>`;
    next.textContent = "Done";
  }
  function updateSaveLeft(room) {
    const el = $("#plLeft"); if (!el) return;
    const v = num($("#planSave").value || "0"), left = r2(room - (Number.isNaN(v) ? 0 : v));
    el.textContent = left >= 0 ? `That leaves ${money(left)} free each month, about ${money(r2(left / 30))} a day` : `That's ${money(-left)} more than you have left after bills and everyday`;
  }
  function planNext() {
    capturePlan();
    const order = ["groups", "amounts", "savings", "summary"], i = order.indexOf(plan.step);
    if (plan.step !== "summary") { plan.step = order[i + 1]; return drawPlan(); }
    const cats = plan.cats.map(x => { const o = {...x}; if (o.group === "bills") delete o.group; else { o.fixed = false; } if (o.group === "free") o.budget = o.budget || 0; return o; });
    saveState({...state, categories: cats, saveMonthly: r2(+plan.save || 0)});
    $("#planDlg").close();
    toast("Plan saved. Your daily number now shows your free money", true);
  }
  $("#planForm").addEventListener("submit", e => { e.preventDefault(); planNext(); });
  $("#planBack").onclick = () => {
    capturePlan();
    const order = ["groups", "amounts", "savings", "summary"], i = order.indexOf(plan.step);
    if (i <= 0) return $("#planDlg").close();
    plan.step = order[i - 1]; drawPlan();
  };
  $("#planBody").addEventListener("input", e => {
    if (e.target.id === "planSave") { const n0 = planNumbers(); return updateSaveLeft(r2(n0.income - n0.billsM - n0.every)); }
    if (!e.target.matches("[data-amt]")) return;
    capturePlan();
    const t2 = $("#plTotal"); if (t2) t2.textContent = money(r2(plan.cats.filter(x => x.group === "everyday").reduce((s2, x) => s2 + (+x.budget || 0), 0)));
  });
  $("#planBody").addEventListener("click", e => {
    const pk = e.target.closest("[data-pick-save]");
    if (pk) { $("#planSave").value = pk.dataset.pickSave; const n0 = planNumbers(); return updateSaveLeft(r2(n0.income - n0.billsM - n0.every)); }
    const mv = e.target.closest("[data-move]");
    if (mv) { capturePlan(); const x = plan.cats.find(k => k.id === mv.dataset.move); if (x) x.group = mv.dataset.to; return drawPlan(); }
    if (e.target.closest("[data-add-cat]")) {
      capturePlan();
      const name = (plan.adding || "").trim().slice(0, 30); if (!name) return toast("Type a name first, e.g. Coffee");
      if (plan.cats.some(k => k.name.toLowerCase() === name.toLowerCase())) return toast(`${name} is already there`);
      plan.cats.push({id: name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") + "-" + uid6().slice(0, 4), name, budget: 0, fixed: false, group: "everyday"});
      plan.adding = ""; drawPlan();
    }
  });
  document.addEventListener("click", e => { if (e.target.closest("[data-plan]")) openPlan(); });

  /* ---------- bills walkthrough ---------- */
  let wiz = null;
  function openWiz(editId) {
    if (!db) return toast("Open this page in Claude to save bills.");
    if (!state) return toast("Finish setting up first.");
    if (editId) {
      const b = bills().find(x => x.id === editId); if (!b) return;
      wiz = {edit: true, queue: [JSON.parse(JSON.stringify(b))], i: 0, step: "amount"};
    } else wiz = {edit: false, picks: new Set(), custom: "", customOn: false, queue: [], i: 0, step: "pick"};
    drawWiz(); $("#billWiz").showModal();
  }
  function pickOptions() {
    const haveCat = new Set(bills().map(b => b.cat).filter(Boolean));
    const taken = bills().map(b => b.name.toLowerCase());
    const SAME = {energy: ["electric", "gas"]};
    const clash = n => { const l = n.toLowerCase(); return taken.some(t => t.includes(l) || l.includes(t) || (SAME[l] || []).some(w => t.includes(w))); };
    const found = ((bank() && bank().found) || []).map((f, i) => ({key: `f:${i}`, name: f.name, amount: f.amount, freq: f.freq || "monthly", day: f.day, cat: f.cat,
      hint: `${money(f.amount)} around the ${ord(f.day)}`})).filter(o => !(o.cat && haveCat.has(o.cat)) && !clash(o.name));
    const foundCats = new Set(found.map(o => o.cat).filter(Boolean));
    const budget = (state.categories || []).filter(c => c.fixed && !haveCat.has(c.id) && !foundCats.has(c.id) && !clash(c.name))
      .map(c => ({key: `c:${c.id}`, name: c.name, amount: c.budget || null, cat: c.id, hint: c.budget ? money(c.budget) : ""}));
    const shown = [...found, ...budget].map(o => o.name.toLowerCase());
    const common = COMMON_BILLS.filter(n => !clash(n) && !shown.some(t => t.includes(n.toLowerCase()) || ({energy: ["electric", "gas"]}[n.toLowerCase()] || []).some(w => t.includes(w)))).map(n => ({key: `x:${n}`, name: n}));
    return {found, budget, common};
  }
  function captureWiz() {
    if (!wiz || !wiz.queue[wiz.i]) { const ci = $("#bwCustom"); if (ci && wiz) wiz.custom = ci.value; return; }
    const d = wiz.queue[wiz.i], v = id => { const el = $("#" + id); return el ? el.value : null; };
    if (v("bwAmt") != null) d.amountRaw = v("bwAmt");
    if (v("bwName") != null) d.name = v("bwName").trim() || d.name;
    if (v("bwDate") != null) d.date = v("bwDate");
    if (v("bwBank") != null) d.from = {kind: "other", name: v("bwBank").trim()};
  }
  const pressed = on => `aria-pressed="${on ? "true" : "false"}"`;
  function drawWiz() {
    const body = $("#bwBody"), back = $("#bwBack"), next = $("#bwNext"), n = wiz.queue.length;
    back.hidden = false;
    if (wiz.step === "pick") {
      const o = pickOptions();
      const chip = x => `<button type="button" class="chip" data-pick="${esc(x.key)}" ${pressed(wiz.picks.has(x.key))}>${esc(x.name)}${x.hint ? `<small>${esc(x.hint)}</small>` : ""}</button>`;
      const group = (title, list) => list.length ? `<p class="pot-group" style="margin:var(--s1) 0 -2px">${title}</p><div class="chips">${list.map(chip).join("")}</div>` : "";
      body.innerHTML = `<h2 id="bwTitle">Which of these do you pay?</h2>
        <p class="muted">Tap everything that goes out regularly. You can add more later.</p>
        ${group("Found in your bank", o.found)}${group("From your budgets", o.budget)}${group("Other common bills", o.common)}
        <div class="chips"><button type="button" class="chip" data-custom-toggle ${pressed(wiz.customOn)}>Something else</button></div>
        ${wiz.customOn ? `<label class="field"><span>What's it called?</span><input id="bwCustom" value="${esc(wiz.custom)}" placeholder="e.g. Car insurance"></label>` : ""}`;
      back.textContent = "Not now";
      next.textContent = "Next";
      wiz.opts = o;
      return;
    }
    if (wiz.step === "done") {
      const c = calc(), added = wiz.saved || [];
      const before = (c.billsDue || []).reduce((s, x) => s + (x.b.amount || 0), 0);
      const total = bills().reduce((s, b) => s + billMonthly(b), 0);
      body.innerHTML = `<h2 id="bwTitle">Your bills are set up</h2>
        <p class="muted">You have ${bills().length} bill${bills().length > 1 ? "s" : ""}, about ${money(total)} a month.${c.payday ? (before ? ` ${money(before)} is due before payday, so that's held back from your spending money.` : " None are due before payday.") : ""}</p>
        <ul class="pots">${added.map(b => billRow(b).replace(/ data-edit-bill="[^"]*" tabindex="0" role="button"/, "")).join("")}</ul>`;
      back.hidden = true; next.textContent = "Done";
      return;
    }
    const d = wiz.queue[wiz.i], nm = esc(d.name), lower = "your " + esc(/^[A-Z][a-z]/.test(d.name) ? d.name[0].toLowerCase() + d.name.slice(1) : d.name);
    const progress = wiz.edit ? "" : `<p class="muted">Bill ${wiz.i + 1} of ${n}</p>`;
    if (wiz.step === "amount") {
      body.innerHTML = `<h2 id="bwTitle">How much is ${lower}?</h2>${progress}
        ${wiz.edit ? `<label class="field"><span>Name</span><input id="bwName" value="${nm}"></label>` : ""}
        <label class="field bigmoney"><span>${d.varies ? "Usual amount" : "Amount"}</span><div class="money"><em>£</em><input id="bwAmt" inputmode="decimal" placeholder="0.00" value="${esc(d.amountRaw ?? (d.amount ?? ""))}"></div></label>
        <label class="check"><input type="checkbox" id="bwVar" ${d.varies ? "checked" : ""}> It changes each time</label>
        ${d.varies ? `<p class="hint muted">We'll hold back the usual amount, and ask you to update it if a payment is different.</p>` : ""}
        ${wiz.edit ? `<button type="button" class="link-btn" data-remove-bill>Remove this bill</button>` : ""}`;
      back.textContent = wiz.edit ? "Cancel" : "Back";
      next.textContent = "Next";
      setTimeout(() => { const a = $("#bwAmt"); if (a && !a.value) a.focus(); }, 30);
      return;
    }
    if (wiz.step === "when") {
      const f = d.freq || "monthly";
      const freqChips = Object.entries(BILL_FREQ).map(([k, t]) => `<button type="button" class="chip" data-freq="${k}" ${pressed(f === k)}>${t}</button>`).join("");
      let pickPart;
      if (f === "monthly") {
        const days = Array.from({length: 31}, (_, i) => `<button type="button" class="daybtn num" data-day="${i + 1}" ${pressed(+d.day === i + 1)} aria-label="${ord(i + 1)}">${i + 1}</button>`).join("");
        pickPart = `<p class="muted">Which day of the month?</p><div class="days7">${days}</div>
          <div class="chips"><button type="button" class="chip" data-day="last" ${pressed(d.day === "last")}>Last working day</button></div>`;
      } else pickPart = `<label class="field"><span>When's the next one?</span><input id="bwDate" type="date" value="${esc(d.date || "")}"></label>`;
      body.innerHTML = `<h2 id="bwTitle">When does ${lower} go out?</h2>${progress}
        <div class="chips">${freqChips}</div>${pickPart}
        <p class="hint muted">${d.day === "last" && f === "monthly" ? "That's the last weekday that isn't a bank holiday." : "If it lands on a weekend or bank holiday, we'll expect it the next working day."}</p>`;
      back.textContent = "Back"; next.textContent = "Next";
      return;
    }
    if (wiz.step === "from") {
      const b = bank(), f = d.from || {};
      const pots = b ? b.pots.filter(p => p.balance > 0 || (p.cats || []).length) : [];
      const opt = (key, label, sub, on) => `<button type="button" class="opt" data-from="${esc(key)}" ${pressed(on)}><span>${esc(label)}</span>${sub ? `<small class="num">${sub}</small>` : ""}</button>`;
      const last = wiz.edit || wiz.i === n - 1;
      body.innerHTML = `<h2 id="bwTitle">Where does ${lower} come from?</h2>${progress}
        <div class="opts">
          ${pots.map(p => opt("pot:" + p.id, potName(p), money(p.balance), f.kind === "pot" && f.id === p.id)).join("")}
          ${opt("main", "Main account", "", f.kind === "main")}
          ${opt("other", "Another bank", "", f.kind === "other")}
        </div>
        ${f.kind === "other" ? `<label class="field"><span>Which bank?</span><input id="bwBank" value="${esc(f.name || "")}" placeholder="e.g. Chase"></label>` : ""}
        <p class="muted" style="margin-top:var(--s2)">How is it paid?</p>
        <div class="chips">${Object.entries(METHOD).map(([k, t]) => `<button type="button" class="chip" data-method="${k}" ${pressed(d.method === k)}>${t}</button>`).join("")}</div>
        ${d.method === "card" && f.kind === "pot" ? `<p class="hint muted">Card payments come out of your main account, not a pot. We'll remind you to move the money across the day before.</p>` : ""}`;
      back.textContent = "Back";
      next.textContent = wiz.edit ? "Save bill" : last ? "Finish" : `Next: ${d.name === wiz.queue[wiz.i + 1].name ? "next bill" : wiz.queue[wiz.i + 1].name}`;
    }
  }
  function wizNext() {
    captureWiz();
    if (wiz.step === "pick") {
      const o = wiz.opts, all = [...o.found, ...o.budget, ...o.common];
      const q = all.filter(x => wiz.picks.has(x.key)).map(x => ({name: x.name, amount: x.amount ?? null, freq: x.freq || "monthly", day: x.day ?? null, cat: x.cat || null}));
      if (wiz.customOn && wiz.custom.trim()) q.push({name: wiz.custom.trim().slice(0, 40), amount: null, freq: "monthly", day: null, cat: null});
      if (!q.length) return toast("Tap at least one bill, or choose Not now to do this later.");
      for (const x of q) { const c = (state.categories || []).find(k => !x.cat && k.name.toLowerCase() === x.name.toLowerCase()); if (c) x.cat = c.id; }
      wiz.queue = q; wiz.i = 0; wiz.step = "amount"; return drawWiz();
    }
    const d = wiz.queue[wiz.i];
    if (wiz.step === "amount") {
      const a = num(String(d.amountRaw ?? d.amount ?? ""));
      if (!(a > 0)) return toast(`Enter how much ${d.name.toLowerCase()} is, e.g. 275`);
      d.amount = r2(a); wiz.step = "when"; return drawWiz();
    }
    if (wiz.step === "when") {
      const f = d.freq || "monthly"; d.freq = f;
      if (f === "monthly" && !d.day) return toast("Tap the day it goes out.");
      if (f !== "monthly" && !d.date) return toast("Pick the date of the next one.");
      wiz.step = "from"; return drawWiz();
    }
    if (wiz.step === "from") {
      if (!d.from || !d.from.kind) return toast(`Choose where ${d.name.toLowerCase()} comes from.`);
      if (!d.method) return toast("Choose how it's paid.");
      if (wiz.i < wiz.queue.length - 1) { wiz.i++; wiz.step = "amount"; return drawWiz(); }
      return finishWiz();
    }
    if (wiz.step === "done") $("#billWiz").close();
  }
  function cleanBill(d) {
    const b = {id: d.id || uid6(), name: d.name.slice(0, 40), amount: d.amount, varies: !!d.varies, freq: d.freq, from: d.from, method: d.method};
    if (d.freq === "monthly") b.day = d.day; else b.date = d.date;
    if (d.cat) b.cat = d.cat;
    if (d.from.kind === "pot") { const p = bank() && bank().pots.find(x => x.id === d.from.id); b.from = {kind: "pot", id: d.from.id, name: p ? potName(p) : ""}; }
    return b;
  }
  function finishWiz() {
    const made = wiz.queue.map(cleanBill);
    if (wiz.edit) {
      saveState({...state, bills: bills().map(b => b.id === made[0].id ? made[0] : b)});
      $("#billWiz").close(); toast(`${made[0].name} updated`, true); return;
    }
    saveState({...state, bills: [...bills(), ...made]});
    wiz.saved = made; wiz.step = "done"; drawWiz();
  }
  function wizBack() {
    captureWiz();
    if (wiz.step === "pick" || (wiz.edit && wiz.step === "amount")) return $("#billWiz").close();
    if (wiz.step === "from") wiz.step = "when";
    else if (wiz.step === "when") wiz.step = "amount";
    else if (wiz.step === "amount") { if (wiz.i > 0) { wiz.i--; wiz.step = "from"; } else wiz.step = "pick"; }
    drawWiz();
  }
  $("#bwForm").addEventListener("submit", e => { e.preventDefault(); wizNext(); });
  $("#bwBack").onclick = wizBack;
  $("#bwBody").addEventListener("change", e => { if (e.target.id === "bwVar") { captureWiz(); wiz.queue[wiz.i].varies = e.target.checked; drawWiz(); } });
  $("#bwBody").addEventListener("click", e => {
    const t = e.target.closest("button"); if (!t || !wiz) return;
    captureWiz();
    const d = wiz.queue[wiz.i];
    if (t.dataset.pick) { wiz.picks.has(t.dataset.pick) ? wiz.picks.delete(t.dataset.pick) : wiz.picks.add(t.dataset.pick); t.setAttribute("aria-pressed", wiz.picks.has(t.dataset.pick)); return; }
    if ("customToggle" in t.dataset) { wiz.customOn = !wiz.customOn; drawWiz(); if (wiz.customOn) $("#bwCustom").focus(); return; }
    if (t.dataset.freq) { d.freq = t.dataset.freq; return drawWiz(); }
    if (t.dataset.day) { d.day = t.dataset.day === "last" ? "last" : +t.dataset.day; return drawWiz(); }
    if (t.dataset.from) {
      const v = t.dataset.from;
      d.from = v === "main" ? {kind: "main"} : v === "other" ? {kind: "other", name: (d.from && d.from.kind === "other" && d.from.name) || ""} : {kind: "pot", id: v.slice(4)};
      drawWiz(); if (v === "other") $("#bwBank").focus(); return;
    }
    if (t.dataset.method) { d.method = t.dataset.method; return drawWiz(); }
    if ("removeBill" in t.dataset) {
      if (!confirm(`Remove ${d.name}? It will stop being held back from your spending money.`)) return;
      saveState({...state, bills: bills().filter(b => b.id !== d.id)});
      $("#billWiz").close(); toast(`${d.name} removed`);
    }
  });
  document.addEventListener("click", e => {
    const ed = e.target.closest("[data-edit-bill]"); if (ed) return openWiz(ed.dataset.editBill);
    if (e.target.closest("[data-bill-wiz]")) openWiz();
  });
  document.addEventListener("keydown", e => { const ed = e.target.closest && e.target.closest("[data-edit-bill]"); if (ed && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); openWiz(ed.dataset.editBill); } });

  /* ---------- render ---------- */
  function render() {
    const c = calc();
    // today's date, short weekday + full month: "Sat 3 October"
    const tt = $("#monthTitle");
    tt.textContent = parseD(viewDay || c.t).toLocaleDateString("en-GB", {weekday: "short", day: "numeric", month: "long"}).replace(",", "");   // "Sat 3 October"
    $("#dayNext").disabled = !viewDay || viewDay >= c.t;
    $("#dayPrev").disabled = (viewDay || c.t) <= addDays(c.t, -330);
    // long dates like "Wednesday 30 September" ease down a little to stay on one line
    tt.style.whiteSpace = "nowrap"; tt.style.fontSize = "";
    for (let px = parseFloat(getComputedStyle(tt).fontSize); tt.scrollWidth > tt.clientWidth + 1 && px > 22; ) { px -= 1; tt.style.fontSize = px + "px"; }
    $("#balanceLine").hidden = true;
    renderPots(); renderBills(c); renderEveryday(c); renderShort(c); renderDeclines(); renderAsk(c); renderCheckin(c); renderIncome(c); renderHero(c); renderSplit(c); renderCatSelect(c); renderCats(c); renderTx(c); renderGoal(c); renderYear();
  }

  function renderHero(c) {
    const h = $("#hero");
    if (!loaded) return;
    $("#cycleCard").hidden = $("#comingCard").hidden = $("#cycleSum").hidden = true;
    h.classList.remove("flippable", "flipped"); h.removeAttribute("role"); h.removeAttribute("tabindex"); h.removeAttribute("aria-label");
    $("#bankCard").hidden = true; $("#wallet").classList.remove("has-peek", "swap");
    if (!state) {
      h.innerHTML = `
        <h2>Set up your tracker</h2>
        <form id="setupForm" class="setup">
          <label class="field"><span>How much is in your account right now?</span>
            <div class="money"><em>£</em><input id="uBal" inputmode="decimal" placeholder="0.00" required></div></label>
          <div><button class="btn primary" type="submit">Start tracking</button></div>
        </form>`;
      $("#setupForm").onsubmit = e => {
        e.preventDefault();
        const b = num($("#uBal").value);
        if (Number.isNaN(b)) return toast("Enter your balance as a number, e.g. 1250.50");
        saveState({
          balance: r2(b), balanceSetAt: Date.now(), balanceAsOf: today(), nextPayday: null, incomes: [],
          categories: [
            {id:"rent", name:"Rent", budget:0, fixed:true},
            {id:"groceries", name:"Groceries", budget:0, fixed:false},
            {id:"eating", name:"Eating out", budget:0, fixed:false},
            {id:"transport", name:"Transport", budget:0, fixed:false},
            {id:"bills", name:"Bills", budget:0, fixed:true},
            {id:"other", name:"Other", budget:0, fixed:false}
          ],
          goal: {name:"", target:0, saved:0}
        });
      };
      return;
    }
    if (!incomes().length && !state.nextPayday) {
      h.innerHTML = `
        <p class="lead">Start with your income</p>
        <p class="sub">You can only spend what comes in, so add where your money comes from first: your job, Student Finance, family, anything. Your payday and daily spending figure are worked out from it.</p>
        <button class="btn primary" type="button" data-add-income>Add your income</button>`;
      return;
    }
    if (c.balance == null) {
      h.innerHTML = `
        <p class="lead">Safe to spend until payday</p>
        <p class="sub">Add the balance your bank app shows right now, and this will show how much you can spend each day without running short.</p>
        <button class="btn primary" type="button" data-open-settings>Add your balance</button>`;
      return;
    }
    if (c.daysLeft == null || c.daysLeft <= 0) {
      h.innerHTML = `
        <p class="lead">${c.daysLeft === 0 ? "Payday is today" : "No payday coming up"}</p>
        <p class="sub">${c.daysLeft === 0 ? "Confirm your pay above and the daily figure will count down to your next payday." : "Add a regular income source so there's a payday to count down to."}</p>
        ${c.daysLeft === 0 ? "" : '<button class="btn primary" type="button" data-add-income>Add income</button>'}`;
      return;
    }
    const free = c.balance - c.billsLeft - c.everydayLeft;   // free money: after bills and what's left of your everyday amounts
    const perDay = free / c.daysLeft;
    const pd = r2(Math.abs(perDay)), whole = Math.floor(pd), pence = Math.round((pd - whole) * 100);
    const billsW = Math.max(0, Math.min(c.billsLeft + c.everydayLeft, Math.max(c.balance, 0)));
    const freeW = Math.max(0, free);
    // pay cycle: from the last payday to the next one
    const mainSrc = incomes().find(s => s.main) || incomes().find(s => s.freq !== "oneoff");
    let start = c.t;
    if (mainSrc) { const past = occurrences(mainSrc, addDays(c.t, -45), c.t); if (past.length) start = past[past.length - 1]; }
    if (start === c.t && c.payday) {
      const prev = mainSrc ? occurrences(mainSrc, addDays(c.t, -45), addDays(c.t, -1)) : [];
      if (prev.length && c.payday > c.t && dayDiff(prev[prev.length - 1], c.payday) <= 45) start = prev[prev.length - 1];
    }
    const flexible = new Set(c.cats.filter(x => !x.fixed).map(x => x.id));
    const spentOn = {};
    const spentAllOn = {};   // everything you spent each day (for the calendar)
    for (const k in months) for (const it of months[k]) if (it.type === "expense" && !it.needsCat && !it.billId && !c.cats.find(x => x.id === it.cat && x.fixed)) {
      spentAllOn[it.date] = (spentAllOn[it.date] || 0) + it.amount;
      const cx = c.cats.find(x => x.id === it.cat);
      if (!cx || catGroup(cx) !== "everyday") spentOn[it.date] = (spentOn[it.date] || 0) + it.amount;   // free spending only
    }
    const allowance = Math.max(0, perDay);
    const tracked = state.balanceAsOf || c.t;
    const total = Math.min(dayDiff(start, c.payday), 62);
    let ticks = "", dows = "", under = 0, past = 0;
    for (let i = 0; i <= total; i++) {
      const ds = addDays(start, i), d = parseD(ds);
      const cls = [];
      const spent = spentOn[ds] || 0;
      if (ds === c.payday) cls.push("payday");
      else if (ds < c.t) {
        if (ds < tracked) cls.push("none");
        else { past++; if (spent <= allowance) { cls.push("under"); under++; } else cls.push("over"); }
      } else if (ds === c.t) { cls.push("today"); if (spent > 0) cls.push(spent <= allowance ? "under" : "over"); }
      if (d.getDay() === 1 && i) cls.push("wk");
      const label = `${niceDate(ds)}${ds === c.payday ? ", payday" : ds <= c.t && ds >= tracked ? `, spent ${money(spent)}` : ""}`;
      ticks += `<i class="${cls.join(" ")}" title="${label}"></i>`;
      dows += `<span class="${[ds === c.t ? "today" : "", ds === c.payday ? "payday" : "", d.getDay() === 1 && i ? "wk" : ""].join(" ").trim()}">${"SMTWTFS"[d.getDay()]}</span>`;
    }
    const dayNo = dayDiff(start, c.t) + 1;
    const cap = past
      ? `Day ${dayNo} of ${total}. You've stayed under ${money(allowance)} on ${under} of ${past} ${past === 1 ? "day" : "days"} so far.`
      : `Day ${dayNo} of ${total}. Keep today's spending under ${money(allowance)} to turn its block green.`;
    // TODAY: one number and what it means for today
    const spentToday = spentOn[c.t] || 0;
    const todayLine = !spentToday
      ? `Lasts you until payday, ${niceDate(c.payday)}`
      : spentToday <= allowance
        ? `${money(r2(allowance - spentToday))} left today after ${money(spentToday)} spent`
        : `${money(spentToday)} spent today. The days ahead adjust`;
    const nextUp = [...(c.billsDue || []).map(x => ({d: x.d, name: x.b.name, amt: money(x.b.amount || 0)})),
      ...(mainSrc && c.payday ? [{d: c.payday, name: `${mainSrc.name} pay`, amt: `+${money(mainSrc.varies ? mainSrc.low : (mainSrc.amount || 0))}`}] : [])]
      .sort((a, b) => a.d < b.d ? -1 : 1)[0] || null;
    const totalBal = r2(c.balance + (bank() ? bank().pots.filter(p => p.role !== "spend").reduce((s, p) => s + (p.balance || 0), 0) : 0));
    renderBankCard(c, totalBal);
    const FLIP = '<svg class="flip-ic" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 4 3 8l4 4"/><path d="M3 8h14"/><path d="m17 20 4-4-4-4"/><path d="M21 16H7"/></svg>';
    const dayMode = viewDay && viewDay !== c.t, day = dayMode ? daySummary(viewDay) : null;
    if (dayMode) heroFlipped = false;   // the explanation is about today, so past days don't flip
    h.classList.add("flippable");
    h.classList.toggle("noflip", !!dayMode);
    h.setAttribute("role", "button"); h.setAttribute("tabindex", "0");
    h.setAttribute("aria-label", heroFlipped ? "Days until payday. Tap to show today's amount." : "Safe to spend today. Tap to show days until payday.");
    h.classList.toggle("flipped", heroFlipped);
    h.innerHTML = `<div class="flip">
      <div class="face front" aria-hidden="${heroFlipped}">
        ${FLIP}
        <div class="wc-top">${balBtn("Total balance", totalBal)}</div>
        <div class="wc-bottom">${dayMode ? `
        <p class="lead">Spent that day</p>
        <p class="big num pos" aria-label="${money(day.spent)} spent"><span class="int">£${Math.floor(day.spent).toLocaleString("en-GB")}</span><span class="pence">.${pad(Math.round((day.spent - Math.floor(day.spent)) * 100) % 100)}</span></p>
        <p class="sub one-line" style="margin-bottom:0">${day.count ? `${day.count} ${day.count === 1 ? "payment" : "payments"}${day.bills ? `, ${money(day.bills)} of it bills` : ""}` : "Nothing spent. A no-spend day"}</p>` : `
        <p class="lead">Safe to spend today</p>
        <p class="big num ${perDay < 0 ? "neg" : "pos"}" aria-label="${perDay < 0 ? "minus " : ""}${money(pd)} a day"><span class="int">${perDay < 0 ? "−" : ""}£${whole.toLocaleString("en-GB")}</span><span class="pence">.${pad(pence)}</span></p>
        <p class="sub one-line" style="margin-bottom:0">${perDay < 0 ? (c.savings >= c.short ? `${money(c.short)} short. Cover it from savings` : `${money(c.short)} short for bills and everyday`) : todayLine}</p>`}
        </div>
      </div>
      <div class="face back${heroFlipped && chocStep !== 0 ? " asked" : ""}${!heroFlipped || chocStep === 0 || chocStep === "a" ? " intro" : ""}" aria-hidden="${!heroFlipped}">
        ${FLIP}
        <div class="why-intro" aria-hidden="true"><span class="l1">How ${perDay < 0 ? "this" : money(pd)} is worked out</span><span class="l2">Think of it like a chocolate bar 🍫</span></div>
        ${(() => {
          const n = free > 0 ? Math.min(c.daysLeft, 62) : 0;
          const rows = 3, cols = Math.max(1, Math.ceil(n / rows));
          let zig = "M6,0 L92,0 C99,22 86,40 94,60 C99,74 90,88 97,100 L6,100";
          for (let y = 100, k = 0; y > 0; y -= 6.25, k++) zig += ` L${k % 2 ? 6 : 0},${Math.max(0, y - 6.25).toFixed(2)}`;
          const WRAPPER = zig + " Z";
          const caps = free > 0
            ? [`Your money is one bar: <b>${money(c.balance)}</b>`, `${c.everydayLeft ? "Bills and everyday snap off first" : "Bills snap off their bit first"}: <b>${money(r2(c.billsLeft + c.everydayLeft))}</b>`, `<b>${money(free)}</b> left, broken into ${n} ${n === 1 ? "piece" : "pieces"}`, `One piece a day. Today's is <b>${money(pd)}</b>`]
            : [`Your money is one bar: <b>${money(c.balance)}</b>`, `Bills${c.everydayLeft ? " and everyday" : ""} want <b>${money(r2(c.billsLeft + c.everydayLeft))}</b>`, `That's <b>${money(-free)}</b> more than the whole bar`, `No pieces left to share until payday`];
          return `<div class="choc s${heroFlipped ? chocStep : 0}" role="img" aria-label="${caps.map(x => x.replace(/<[^>]+>/g, "")).join(". ")}.">
            <div class="choc-stage">
              <div class="choc-bar">
                <div class="choc-chunk"><svg class="wrap" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><path d="${WRAPPER}"/></svg><span>Bills</span></div>
                <div class="choc-rest">${"<i></i>".repeat(12)}</div>
              </div>
              ${n ? `<div class="choc-days" style="grid-template-columns:repeat(${cols},1fr)">${Array.from({length: cols * 3}, (_, k) => `<i${k === 0 ? ' class="today"' : k >= n ? ' class="extra"' : ""}></i>`).join("")}</div>` : ""}
            </div>
            <p class="choc-cap" aria-hidden="true">${caps.map((x, k) => `<span class="c${k + 1}">${x}</span>`).join("")}</p>
          </div>`;
        })()}
      </div>
    </div>`;

    fitBig();
    document.querySelectorAll("#hero .one-line").forEach(el => {
      el.style.fontSize = "";
      for (let px = parseFloat(getComputedStyle(el).fontSize); el.scrollWidth > el.clientWidth + 1 && px > 12; ) { px -= .5; el.style.fontSize = px + "px"; }
    });
    sizeFlip();
    countHero(dayMode ? day.spent : (perDay < 0 ? -pd : pd));
    if (heroCounting) heroCounting();

    // MONTH: payday to payday
    const cyc = $("#cycleCard");
    cyc.hidden = false;
    // no "pace" judgement: spending big one day simply lowers the amount for the days after, and that's fine
    const dueOn = {};
    for (const x of (c.billsDue || [])) (dueOn[x.d] = dueOn[x.d] || []).push(x.b);
    const freeAbs = Math.abs(free), fw = Math.floor(freeAbs), fp = Math.round((freeAbs - fw) * 100) % 100;
    // --- the calendar: payday to payday, weeks start on Monday
    const first = parseD(start), lead = (first.getDay() + 6) % 7;
    let cells = ["M", "T", "W", "T", "F", "S", "S"].map(d => `<span class="mc-dow" aria-hidden="true">${d}</span>`).join("") + "<span></span>".repeat(lead);
    for (let d = start; d <= c.payday; d = addDays(d, 1)) {
      const n = +d.slice(8), cls = ["mc-day"], spent = spentAllOn[d] || 0;
      let note = "", label = niceDate(d);
      if (d === c.payday) { cls.push("pay"); note = "Pay"; label += ", payday"; }
      else if (d < c.t) {
        if (d < tracked) { cls.push("none"); }
        else if (!spent) { cls.push("zero"); note = "★"; label += ", no-spend day"; }
        else { cls.push("spent"); note = "£" + Math.round(spent); label += `, spent ${money(spent)}`; }
      } else {
        const due = (dueOn[d] || []).reduce((s2, b2) => s2 + (b2.amount || 0), 0);
        if (due) { cls.push("bill"); note = "£" + Math.round(due); label += `, ${(dueOn[d] || []).map(b2 => b2.name).join(" and ")} due`; }
        if (d === c.t) { cls.push("today"); label += ", today"; if (!due && spent) note = "£" + Math.round(spent); }
      }
      cells += `<button type="button" class="${cls.join(" ")}" data-mday="${d}" aria-label="${esc(label)}"><b>${n}</b><small>${note}</small></button>`;
    }
    // the money summary sits in its own card above the calendar
    const sum = $("#cycleSum");
    sum.hidden = false;
    sum.innerHTML = `
      <p class="mc-lead">${free >= 0 ? "Free until payday" : "Short before payday"}</p>
      <p class="mc-big num${free < 0 ? " neg" : ""}"><span class="int">${free < 0 ? "−" : ""}£${fw.toLocaleString("en-GB")}</span><span class="pence">.${pad(fp)}</span></p>
      <p class="mc-sub">${free >= 0 ? `After ${money(c.billsLeft)} of bills${c.everydayLeft ? ` and ${money(c.everydayLeft)} of everyday` : ""}. Spend it whenever suits you` : `You have ${money(c.balance)} but need ${money(c.need)} for bills and everyday.${c.savings >= c.short ? ` Move ${money(c.short)} from savings to cover it.` : c.savings > 0 ? ` Savings can cover ${money(c.savings)} of it.` : ""}`}</p>
      <div id="moneySplit"></div>`;
    cyc.innerHTML = `
      <div class="panel-head"><h2>Payday to payday</h2><span class="muted num">Day ${dayNo} of ${total}</span></div>
      <div class="mc-grid" role="group" aria-label="Payday to payday calendar">${cells}</div>
      <div class="mc-key"><span><i class="k-zero"></i>No-spend day</span><span><i class="k-bill"></i>Bill due</span><span><i class="k-pay"></i>Payday</span></div>
      <p class="mc-detail" id="mcDetail" hidden></p>`;
    cyc.querySelector(".mc-grid").onclick = e => {
      const btn = e.target.closest(".mc-day"); if (!btn) return;
      const d = btn.dataset.mday;
      if (d < c.t || d === c.t) { viewDay = d === c.t ? null : d; setView("month"); return; }
      const bl = dueOn[d] || [], det = $("#mcDetail");
      cyc.querySelectorAll(".mc-day.sel").forEach(x => x.classList.remove("sel")); btn.classList.add("sel");
      det.hidden = false;
      det.innerHTML = d === c.payday
        ? `<b>${niceDate(d)}</b>: payday. ${mainSrc ? `${esc(mainSrc.name)} pays at least ${money(mainSrc.varies ? mainSrc.low : (mainSrc.amount || 0))}.` : ""}`
        : `<b>${niceDate(d)}</b>: ${bl.length ? bl.map(b2 => `${esc(b2.name)} ${money(b2.amount || 0)}`).join(", ") + " due. It's already set aside, so it won't touch your daily amount." : "No bills due."}`;
    };

    // MONTH: what's coming, in date order
    const com = $("#comingCard");
    com.hidden = false;
    const coming = (c.billsDue || []).map(x => ({d: x.d, name: x.b.name, meta: `From ${billSource(x.b)}`, amt: `−${money(x.b.amount || 0)}`}));
    if (mainSrc) coming.push({d: c.payday, name: `${mainSrc.name} pay`, meta: mainSrc.varies ? `Usually ${money(mainSrc.typical || mainSrc.low)}, at least ${money(mainSrc.low)}` : "Payday", amt: `+${money(mainSrc.varies ? mainSrc.low : (mainSrc.amount || 0))}`, good: true});
    coming.sort((a, b) => a.d < b.d ? -1 : 1);
    com.innerHTML = `<div class="panel-head"><h2>Coming up</h2>${bills().length ? "" : `<button class="btn ghost small" type="button" data-bill-wiz>Add bills</button>`}</div>
      <ul class="pots">${coming.map(x => `<li><div><span class="pname">${esc(x.name)}</span><span class="pmeta">${niceDate(x.d)}. ${esc(x.meta)}</span></div><span class="pamt num${x.good ? " good-txt" : ""}">${x.amt}</span></li>`).join("")}</ul>
      ${!(c.billsDue || []).length ? `<p class="pot-group">${bills().length ? "No bills due before payday." : "Add your bills to see when each one goes out."}</p>` : ""}`;
  }

  function renderCatSelect(c) {
    const kind = document.querySelector('input[name="kind"]:checked').value;
    const opts = kind === "income"
      ? [...incomes().map(s => [s.id, s.name]), ["gift","Gift from family or friends"], ["other-income","Other income"]]
      : c.cats.map(x => [x.id, x.name]);
    const sig = kind + JSON.stringify(opts);
    if (sig === catSig) return;
    catSig = sig;
    const sel = $("#fCat"), prev = sel.value;
    sel.innerHTML = opts.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join("");
    if (opts.some(o => o[0] === prev)) sel.value = prev;
  }

  function potLine(x) {
    const p = potFor(x.id);
    if (!p) return "";
    return `. ${money(p.balance)} in ${esc(potName(p))}${(p.cats || []).length > 1 ? ", shared" : ""}`;
  }
  function renderCats(c) {
    const list = $("#cats");
    if (!state) { list.innerHTML = `<li class="empty">Your budgets will show here once you're set up.</li>`; $("#budgetSum").textContent = ""; return; }
    const total = c.cats.reduce((s, x) => s + (x.budget || 0), 0);
    $("#budgetSum").textContent = `${money(c.cats.filter(x => catGroup(x) === "everyday").reduce((s, x) => s + (x.budget || 0), 0))} a month`;
    const known = new Set(c.cats.map(x => x.id));
    const billCats = new Set(bills().map(b => b.cat).filter(Boolean));
    const shown = c.cats.filter(x => catGroup(x) === "everyday");
    const spentSince = {};
    for (const e of c.everyday) spentSince[e.x.id] = e.spent;
    const rows = shown.map(x => {
      const sp = spentSince[x.id] || 0, b = x.budget || 0, left = b - sp;
      const pct = b ? Math.min(100, sp / b * 100) : (sp ? 100 : 0);
      let cls = "cat", leftTxt;
      if (x.fixed) {
        cls += " fixed";
        if (b && sp >= b) { cls += " paid"; leftTxt = "Paid"; }
        else leftTxt = b ? `${money(left)} due` : money(sp);
        if (sp > b && b) { cls += " over"; leftTxt = `${money(-left)} over`; }
      } else if (!b) leftTxt = sp ? `${money(sp)} spent` : "No budget";
      else if (left < 0) { cls += " over"; leftTxt = `${money(-left)} over`; }
      else { cls += " under"; leftTxt = `${money(left)} left`; }
      return `<li class="${cls}">
        <div class="cat-top"><span class="name">${esc(x.name)}${x.fixed ? '<span class="tag">Bill</span>' : ""}</span><span class="left">${leftTxt}</span></div>
        <div class="bar"><i style="width:${pct}%"></i></div>
        <div class="cat-sub muted num">${money(sp)} of ${money(b)}</div></li>`;
    });
    const orphan = Object.keys(c.spent).filter(k => !known.has(k)).reduce((s, k) => s + c.spent[k], 0);
    if (orphan) rows.push(`<li class="cat"><div class="cat-top"><span class="name">Removed categories</span><span class="left">${money(orphan)} spent</span></div></li>`);
    const baseIncome = incomes().reduce((s, x) => s + perMonth(x), 0);
    if (incomes().length && total > baseIncome) rows.push(`<li class="note">Your budgets add up to ${money(total - baseIncome)} more than the ${money(baseIncome)} a month you can count on. Trim a budget or add missing income.</li>`);
    list.innerHTML = rows.join("") || `<li class="empty">Nothing set yet. Tap Plan to choose what you spend on every month, like groceries or coffee.</li>`;
  }

  function catLabel(it, c) {
    if (it.type === "income") {
      const s = incomes().find(x => x.id === it.cat);
      return s ? s.name : it.cat === "paycheck" ? "Paycheck" : it.cat === "gift" ? "Gift" : it.cat === "monzo-in" ? "Money in" : "Other income";
    }
    if (it.type === "save") return "Moved to savings";
    const f = c.cats.find(x => x.id === it.cat);
    return f ? f.name : "Removed category";
  }

  let txAll = false;
  function renderTx(c) {
    $("#monthSum").innerHTML = state ? `<span class="muted">Received <b class="${c.inTotal > 0 ? "good-txt" : ""}" style="color:var(--ink)">${money(c.inTotal)}</b></span><span class="muted">Spent <b style="color:var(--ink)">${money(c.spentTotal)}</b></span>${c.savedMonth ? `<span class="muted">Saved <b class="good-txt">${money(c.savedMonth)}</b></span>` : ""}` : "";
    const items = [...c.items].sort((a, b) => b.date.localeCompare(a.date) || (b.created || 0) - (a.created || 0));
    if (!items.length) { $("#todayList").innerHTML = `<li style="display:block;border:0"><p class="empty" style="margin:0">Nothing spent today.</p></li>`; $("#txList").innerHTML = `<li style="display:block;border:0"><p class="empty">Nothing this month yet. Payments appear here when you refresh from Monzo or add one.</p></li>`; return; }
    const row = it => {
      const cat = catLabel(it, c), title = it.note || cat, inflow = it.type === "income";
      return `<li>
        <div class="what"><b>${esc(title)}</b><span class="muted">${niceDate(it.date)}${it.note ? ", " + esc(cat) : ""}</span></div>
        <span class="amt ${inflow ? "in" : ""}">${inflow ? "+" : "−"}${money(it.amount)}</span>
        <button class="x" type="button" data-del="${esc(it.id)}" aria-label="Delete ${esc(title)}">×</button></li>`;
    };
    const vd = viewDay || c.t, dayItems = (months[vd.slice(0, 7)] || []).filter(it => it.date === vd && it.type === "expense").sort((a, b) => (b.created || 0) - (a.created || 0));
    $("#todayHead").textContent = vd === c.t ? "Spent today" : `Spent on ${niceDate(vd)}`;
    $("#todayList").innerHTML = dayItems.length ? dayItems.map(row).join("") : `<li style="display:block;border:0"><p class="empty" style="margin:0">Nothing spent ${vd === c.t ? "today" : "that day"}.</p></li>`;
    $("#txMore").hidden = items.length <= 5;
    $("#txMore").textContent = txAll ? "Show fewer" : `Show all ${items.length}`;
    $("#txList").innerHTML = (txAll ? items : items.slice(0, 5)).map(it => {
      const cat = catLabel(it, c), title = it.note || cat;
      const inflow = it.type === "income";
      return `<li>
        <div class="what"><b>${esc(title)}</b><span class="muted">${niceDate(it.date)}${it.note ? ", " + esc(cat) : ""}</span></div>
        <span class="amt ${inflow ? "in" : ""}">${inflow ? "+" : "−"}${money(it.amount)}</span>
        <button class="x" type="button" data-del="${esc(it.id)}" aria-label="Delete ${esc(title)}">×</button></li>`;
    }).join("");
  }

  function renderGoal(c) {
    const g = $("#goal");
    if (!state) { g.innerHTML = `<h2>Savings</h2><p class="empty">Set a savings goal once you're set up.</p>`; return; }
    const goal = state.goal || {name:"", target:0, saved:0};
    if (!goal.name || !goal.target) {
      g.innerHTML = `<h2>Savings</h2><p class="empty">Set a goal, like an emergency fund, and move money into it as you go.</p>
        <p><button class="btn ghost" type="button" data-open-settings>Set a savings goal</button></p>`;
      return;
    }
    const pct = Math.min(100, (goal.saved || 0) / goal.target * 100);
    g.innerHTML = `
      <div class="panel-head"><h2>${esc(goal.name)}</h2><span class="muted num">${Math.round(pct)}%</span></div>
      <div class="goal-fig num">${money(goal.saved || 0)} <span class="muted" style="font-size:1rem;font-weight:400;font-family:var(--body)">of ${money(goal.target)}</span></div>
      <div class="bar"><i style="width:${pct}%"></i></div>
      <form id="saveForm" class="goal-row">
        <div class="money"><em>£</em><input id="gAmt" inputmode="decimal" placeholder="Amount" aria-label="Amount to move to savings"></div>
        <button class="btn good" type="submit">Move to savings</button>
      </form>`;
    $("#saveForm").onsubmit = e => {
      e.preventDefault();
      const a = num($("#gAmt").value);
      if (!(a > 0)) return toast("Enter an amount to move, e.g. 50");
      const t = today(), tx = {id: uid6(), type:"save", amount:r2(a), cat:"savings", note:"", date:t, created:Date.now()};
      writeMonth(t.slice(0, 7), items => { items.push(tx); return items; });
      saveState({...state, goal:{...goal, saved:r2((goal.saved || 0) + a)}});
      const pctNow = Math.min(100, Math.round(((goal.saved || 0) + a) / goal.target * 100));
      toast(`Nice. ${money(a)} saved, you're ${pctNow}% of the way to ${goal.name}`, true);
    };
  }


  /* ---------- year view ---------- */
  let view = "month", viewYear = +today().slice(0, 4);
  const MON = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const planOf = k => (state && state.plan && state.plan[k]) || {};
  const planOn = k => !!(state && state.planStart && k >= state.planStart);
  function planIncome(k) {
    const p = planOf(k);
    if (typeof p.income === "number") return p.income;
    if (planOn(k) && incomes().length) return incomeForMonth(k);
    if (planOn(k) && typeof state.usualPay === "number") return state.usualPay;
    return null;
  }
  function planCat(k, c) {
    const p = planOf(k);
    if (p.cats && typeof p.cats[c.id] === "number") return p.cats[c.id];
    return planOn(k) ? (c.budget || 0) : null;
  }
  function actualsOf(k) {
    const items = months[k] || [];
    const a = {has: items.length > 0, inc: 0, save: 0, cats: {}, other: 0};
    const known = new Set(((state && state.categories) || []).map(c => c.id));
    for (const it of items) {
      if (it.type === "income") a.inc += it.amount;
      else if (it.type === "save") a.save += it.amount;
      else if (known.has(it.cat)) a.cats[it.cat] = (a.cats[it.cat] || 0) + it.amount;
      else a.other += it.amount;
    }
    return a;
  }
  // full-month figures used for totals, chart and projection
  function monthFig(k, cur) {
    const cats = (state && state.categories) || [];
    const a = actualsOf(k), pi = planIncome(k);
    let inc = null, out = 0, anyOut = false, kind;
    if (k < cur) {
      if (a.has) { kind = "actual"; inc = a.inc; out = a.other + cats.reduce((s, c) => s + (a.cats[c.id] || 0), 0); anyOut = true; }
      else { kind = "plan"; inc = pi; for (const c of cats) { const p = planCat(k, c); if (p != null) { out += p; anyOut = true; } } }
      return {kind, inc, out: anyOut ? out : null, save: a.save};
    }
    if (k === cur) {
      inc = Math.max(a.inc, pi || 0);
      for (const c of cats) out += Math.max(a.cats[c.id] || 0, planCat(k, c) || 0);
      out += a.other;
      return {kind: "current", inc, out, save: a.save,
        remIn: Math.max(0, (pi || 0) - a.inc),
        remOut: cats.reduce((s, c) => s + Math.max(0, (planCat(k, c) || 0) - (a.cats[c.id] || 0)), 0)};
    }
    for (const c of cats) { const p = planCat(k, c); if (p != null) { out += p; anyOut = true; } }
    return {kind: "plan", inc: pi, out: anyOut ? out : null, save: 0};
  }
  function projections(cur, balance, untilKey) {
    const res = {};
    if (balance == null || untilKey < cur) return res;
    const f0 = monthFig(cur, cur);
    let b = balance + f0.remIn - f0.remOut;
    res[cur] = b;
    for (let k = addMonths(cur, 1); k <= untilKey; k = addMonths(k, 1)) {
      const f = monthFig(k, cur);
      b += (f.inc || 0) - (f.out || 0);
      res[k] = b;
    }
    return res;
  }

  function renderYear() {
    if (view !== "year" || !state) {
      if (view === "year" && !state) $("#tiles").innerHTML = `<p class="muted">Set up the tracker on the Month page first.</p>`;
      return;
    }
    const c = calc(), cur = c.cur, Y = viewYear;
    const keys = MON.map((_, i) => `${Y}-${pad(i + 1)}`);
    for (const k of keys) if (k <= cur) subscribeMonth(k);
    $("#yrLabel").textContent = Y;
    $("#usualForm").hidden = incomes().length > 0;
    const up = $("#usualPay");
    if (document.activeElement !== up) up.value = typeof state.usualPay === "number" ? state.usualPay : "";

    const figs = {}; keys.forEach(k => figs[k] = monthFig(k, cur));
    const proj = projections(cur, c.balance, keys[11]);
    const cats = state.categories || [];

    // tiles
    let yIn = 0, yOut = 0;
    for (const k of keys) { yIn += figs[k].inc || 0; yOut += figs[k].out || 0; }
    const endBal = proj[keys[11]];
    const futureKeys = keys.filter(k => k > cur && figs[k].inc != null);
    const avg = futureKeys.length ? futureKeys.reduce((s, k) => s + (figs[k].inc || 0) - (figs[k].out || 0), 0) / futureKeys.length : null;
    $("#tiles").innerHTML = `
      <div class="tile"><p>Balance on 31 Dec</p><b class="num ${endBal != null && c.balance != null && endBal > c.balance ? "gain" : ""}">${endBal == null ? "–" : money(endBal)}</b><span>${endBal == null ? (c.balance == null ? "Add your balance in Settings" : "Only for this year onwards") : "Projected from your plan"}</span></div>
      <div class="tile"><p>Money in, ${Y}</p><b class="num ${yIn > 0 ? "gain" : ""}">${money(yIn)}</b><span>Actual plus planned</span></div>
      <div class="tile"><p>Money out, ${Y}</p><b class="num">${money(yOut)}</b><span>Actual plus planned</span></div>
      <div class="tile"><p>Left over per month</p><b class="num ${avg > 0 ? "gain" : ""}">${avg == null ? "–" : money(avg)}</b><span>${avg == null ? "Set your usual pay to forecast" : "Average for the months ahead"}</span></div>`;

    // chart
    const vals = keys.map(k => { const f = figs[k]; return (f.inc == null && f.out == null) ? null : (f.inc || 0) - (f.out || 0); });
    const W = 1100, H = 190, top = 14, bottom = 30, lh = H - top - bottom;
    const mx = Math.max(1, ...vals.filter(v => v != null).map(Math.abs));
    const hasNeg = vals.some(v => v != null && v < 0);
    const zero = hasNeg ? top + lh / 2 : top + lh;
    const scale = (hasNeg ? lh / 2 : lh) / mx;
    const bw = W / 12;
    let bars = "";
    keys.forEach((k, i) => {
      const v = vals[i], x = i * bw + bw * 0.2, w = bw * 0.6;
      const planned = figs[k].kind === "plan" || k > cur;
      if (v != null) {
        const hgt = Math.max(1, Math.abs(v) * scale), y = v >= 0 ? zero - hgt : zero;
        bars += `<rect class="${v >= 0 ? "gainbar" : ""}" x="${x}" y="${y}" width="${w}" height="${hgt}" rx="3" fill="${v >= 0 ? (planned ? "url(#hatchG)" : "var(--good-fill)") : (planned ? "url(#hatch)" : "var(--ink)")}" stroke="${v >= 0 ? "var(--good)" : "var(--ink)"}" stroke-width="${planned ? 1 : 0}"><title>${MON[i]}: ${money(v)}</title></rect>`;
      }
      bars += `<text x="${i * bw + bw / 2}" y="${H - 8}" text-anchor="middle" ${k === cur ? 'style="fill:var(--ink);font-weight:600"' : ""}>${MON[i]}</text>`;
    });
    $("#chart").innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Money left over each month in ${Y}">
      <defs><pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="2" height="6" fill="var(--ink)"/></pattern><pattern id="hatchG" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="2" height="6" fill="var(--good-fill)"/></pattern></defs>
      <line x1="0" x2="${W}" y1="${zero}" y2="${zero}" stroke="var(--line)"/>${bars}</svg>`;

    // sheet
    const head = `<thead><tr><th>${Y}</th>${keys.map((k, i) => `<th class="${k === cur ? "cur" : ""}">${MON[i]}</th>`).join("")}<th class="col-tot">Total</th></tr></thead>`;
    const cell = (k, row, actual, plan) => {
      const editable = k >= cur;
      const attrs = editable ? ` class="edit {cls}" data-k="${k}" data-row="${row}" tabindex="0"` : ` class="{cls}"`;
      const isSet = row === "income" ? typeof planOf(k).income === "number" : !!(planOf(k).cats && typeof planOf(k).cats[row] === "number");
      let cls = "", html = "";
      if (k < cur) {
        if (actual != null) { html = money(actual); if (plan != null && actual > plan && row !== "income") cls = "over"; }
        else if (plan != null) { html = money(plan); cls = "plan"; }
      } else if (k === cur) {
        html = `${money(actual || 0)}${plan != null ? `<small>of ${money(plan)}</small>` : ""}`;
        if (plan != null && (actual || 0) > plan && row !== "income") cls = "over";
      } else if (plan != null) { html = money(plan); cls = "plan"; }
      if (editable && isSet) cls += " set";
      if (row === "income" && html && ((actual || 0) > 0 || (k > cur && plan > 0) || (k < cur && actual == null && plan > 0))) cls += " gain";
      return `<td${attrs.replace("{cls}", cls.trim())}>${html}</td>`;
    };
    let body = `<tbody><tr class="sec"><td>Money in</td>${"<td></td>".repeat(13)}</tr>`;
    let incTot = 0;
    body += `<tr><td>Pay and income</td>${keys.map(k => {
      const a = actualsOf(k), pi = planIncome(k);
      const actual = k <= cur && (a.has || k === cur) ? a.inc : null;
      incTot += figs[k].inc || 0;
      return cell(k, "income", actual, pi);
    }).join("")}<td class="col-tot">${money(incTot)}</td></tr>`;
    body += `<tr class="sec"><td>Money out</td>${"<td></td>".repeat(13)}</tr>`;
    for (const ct of cats) {
      let tot = 0;
      const tds = keys.map(k => {
        const a = actualsOf(k), p = planCat(k, ct);
        const actual = k <= cur && (a.has || k === cur) ? (a.cats[ct.id] || 0) : null;
        tot += k < cur ? (actual != null ? actual : (p || 0)) : k === cur ? Math.max(actual || 0, p || 0) : (p || 0);
        return cell(k, ct.id, actual, p);
      }).join("");
      body += `<tr><td>${esc(ct.name)}</td>${tds}<td class="col-tot">${money(tot)}</td></tr>`;
    }
    const otherAny = keys.some(k => actualsOf(k).other);
    if (otherAny) body += `<tr><td>Removed categories</td>${keys.map(k => `<td>${actualsOf(k).other ? money(actualsOf(k).other) : ""}</td>`).join("")}<td class="col-tot">${money(keys.reduce((s, k) => s + actualsOf(k).other, 0))}</td></tr>`;
    body += `<tr class="total"><td>Total out</td>${keys.map(k => `<td class="${figs[k].kind === "plan" && k !== cur ? "plan" : ""}">${figs[k].out == null ? "" : money(figs[k].out)}</td>`).join("")}<td class="col-tot">${money(yOut)}</td></tr>`;
    body += `<tr class="total"><td>Left over</td>${keys.map((k, i) => `<td class="${figs[k].kind === "plan" && k !== cur ? "plan" : ""} ${vals[i] > 0 ? "gain" : ""}">${vals[i] == null ? "" : money(vals[i])}</td>`).join("")}<td class="col-tot ${yIn - yOut > 0 ? "gain" : ""}">${money(yIn - yOut)}</td></tr>`;
    const saveAny = keys.some(k => actualsOf(k).save);
    if (saveAny) body += `<tr><td>Moved to savings</td>${keys.map(k => `<td>${actualsOf(k).save ? money(actualsOf(k).save) : ""}</td>`).join("")}<td class="col-tot">${money(keys.reduce((s, k) => s + actualsOf(k).save, 0))}</td></tr>`;
    body += `<tr class="bal"><td>Balance at month end</td>${keys.map(k => `<td class="${k > cur ? "plan" : ""} ${proj[k] != null && proj[addMonths(k, -1)] != null && proj[k] > proj[addMonths(k, -1)] ? "gain" : ""}">${proj[k] == null ? "" : money(proj[k])}</td>`).join("")}<td class="col-tot"></td></tr></tbody>`;
    $("#sheet").innerHTML = head + body;
  }

  function editCell(td) {
    if (td.querySelector("input")) return;
    const k = td.dataset.k, row = td.dataset.row;
    const cat = (state.categories || []).find(x => x.id === row);
    const cur = row === "income" ? planIncome(k) : planCat(k, cat);
    td.innerHTML = `<input inputmode="decimal" aria-label="Plan for ${MON[+k.slice(5) - 1]}" value="${cur == null ? "" : cur}">`;
    const inp = td.querySelector("input"); inp.focus(); inp.select();
    let done = false;
    const commit = save => {
      if (done) return; done = true;
      if (!save) return renderYear();
      const raw = inp.value.trim(), v = num(raw);
      if (raw && Number.isNaN(v)) { toast("Enter a number, e.g. 250"); return renderYear(); }
      const plan = JSON.parse(JSON.stringify(state.plan || {}));
      const p = plan[k] || (plan[k] = {});
      if (row === "income") { if (raw) p.income = r2(v); else delete p.income; }
      else { p.cats = p.cats || {}; if (raw) p.cats[row] = r2(v); else delete p.cats[row]; }
      const next = {...state, plan};
      if (!next.planStart || k < next.planStart) next.planStart = k;
      saveState(next);
    };
    inp.addEventListener("keydown", e => { if (e.key === "Enter") commit(true); if (e.key === "Escape") commit(false); });
    inp.addEventListener("blur", () => commit(true));
  }
  $("#sheet").addEventListener("click", e => { const td = e.target.closest("td.edit"); if (td) editCell(td); });
  $("#sheet").addEventListener("keydown", e => { const td = e.target.closest("td.edit"); if (td && e.key === "Enter" && e.target === td) editCell(td); });
  $("#yrPrev").onclick = () => { viewYear--; renderYear(); };
  $("#yrNext").onclick = () => { viewYear++; renderYear(); };
  $("#usualForm").addEventListener("submit", e => {
    e.preventDefault();
    if (!state) return;
    const raw = $("#usualPay").value.trim(), v = num(raw);
    if (raw && Number.isNaN(v)) return toast("Enter a number, e.g. 1900");
    const next = {...state};
    if (raw) next.usualPay = r2(v); else delete next.usualPay;
    if (!next.planStart) next.planStart = today().slice(0, 7);
    saveState(next); $("#usualPay").blur(); toast("Usual pay saved");
  });
  function setView(v) {
    view = v;
    $("#monthView").hidden = v !== "month";
    $("#planView").hidden = v !== "plan";
    $("#yearView").hidden = v !== "year";
    $("#tabMonth").setAttribute("aria-selected", v === "month");
    $("#tabPlan").setAttribute("aria-selected", v === "plan");
    $("#tabYear").setAttribute("aria-selected", v === "year");
    render();
  }
  $("#tabMonth").onclick = () => { viewDay = null; setView("month"); };
  $("#tabYear").onclick = () => setView("year");
  $("#tabPlan").onclick = () => setView("plan");
  $("#openAdd").onclick = () => { $("#fDate").value = viewDay || today(); $("#addDlg").showModal(); setTimeout(() => $("#fAmt").focus(), 30); };
  $("#addCancel").onclick = () => $("#addDlg").close();
  $("#txMore").onclick = () => { txAll = !txAll; render(); };


  /* ---------- income UI ---------- */
  function renderIncome(c) {
    const list = $("#incomeList");
    if (!state) { list.innerHTML = ""; $("#incomeSum").textContent = ""; return; }
    const inc = incomes();
    if (!inc.length) {
      $("#incomeSum").textContent = ""; $("#oneOffWrap").hidden = true;
      list.innerHTML = `<li class="note" style="cursor:default">Add every way money reaches you: work, Student Finance, family or friends, side projects. Everything else is planned around it.</li>`;
      return;
    }
    const t0 = today(), skip0 = state.skipped || {};
    const regular = inc.filter(x => x.freq !== "oneoff");
    const oneoffs = inc.filter(x => x.freq === "oneoff" && x.date && !isReceived(x.id, x.date) && !skip0[ciKey(x.id, x.date)])
      .sort((a, b) => a.date.localeCompare(b.date));
    $("#oneOffWrap").hidden = !oneoffs.length;
    $("#oneOffList").innerHTML = oneoffs.map(s => {
      const d = dayDiff(t0, s.date);
      const when = d === 0 ? "Today" : d === 1 ? "Tomorrow" : d < 0 ? `Was due ${niceDate(s.date)}` : `${niceDate(s.date)}, in ${d} days`;
      const amt = s.varies ? `${money(s.low || 0)} to ${money(s.typical || s.low || 0)}` : money(s.amount || 0);
      const kind = {family: "From family or friends", business: "Side hustle", work: "Work", student: "Student Finance", benefits: "Benefits", other: "Other"}[s.type];
      return `<li data-edit-income="${esc(s.id)}" tabindex="0" role="button">
        <div><span class="iname">${esc(s.name)}</span><span class="imeta">${kind}</span></div>
        <div><span class="iamt num">${amt}</span><span class="soon">${when}</span></div></li>`;
    }).join("");
    if (!regular.length) {
      $("#incomeSum").textContent = "";
      $("#incomeList").innerHTML = `<li class="note" style="cursor:default">Add your regular pay too, so there's a payday to count down to.</li>`;
      return;
    }
    const monthly = inc.reduce((s, x) => s + perMonth(x), 0);
    $("#incomeSum").innerHTML = `About <b class="good-txt">${money(monthly)}</b> a month you can count on`;
    const t = today();
    list.innerHTML = regular.map(s => {
      const nxt = occurrences(s, t, addDays(t, 400)).find(d => !isReceived(s.id, d));
      const amt = s.varies ? `${money(s.low || 0)} to ${money(s.typical || s.low || 0)}` : money(s.amount || 0);
      const when = s.freq === "monthly-date" ? `Monthly on the ${s.day}${[,"st","nd","rd"][s.day % 10 * (s.day < 11 || s.day > 13)] || "th"}` : FREQ[s.freq];
      return `<li data-edit-income="${esc(s.id)}" tabindex="0" role="button">
        <div><span class="iname">${esc(s.name)}${s.main ? '<span class="tag">Main pay</span>' : ""}</span>
        <span class="imeta">${when}${nxt ? `, next ${niceDate(nxt)}` : ""}</span></div>
        <span class="iamt num">${amt}</span></li>`;
    }).join("");
  }

  function renderCheckin(c) {
    const box = $("#checkin");
    if (!state || !db) { box.innerHTML = ""; return; }
    const pend = pendingCheckins();
    if (!pend.length) { box.innerHTML = ""; return; }
    const p = pend[0], s = p.src;
    if (box.dataset.key === p.key && box.innerHTML) return;
    box.dataset.key = p.key;
    const expect = s.varies ? `Usually ${money(usualAmt(s))}, at least ${money(lowAmt(s))}.` : `Expected ${money(s.amount || 0)}.`;
    box.innerHTML = `<details class="panel checkin todo"><summary><span class="todo-dot" aria-hidden="true"></span><span class="todo-txt">${p.date === today() ? "Payday check" : "Missed payday check"}<small>${esc(s.name)}, due ${p.date === today() ? "today" : niceDate(p.date)}</small></span></summary>
      <h2>Did your ${esc(s.name)} ${s.type === "work" ? "pay" : "money"} arrive?</h2>
      <p class="muted">Due ${p.date === today() ? "today" : niceDate(p.date)}. ${expect} Confirm the amount that actually landed so your balance stays real.</p>
      <form class="ci-row" id="ciForm">
        <div class="money"><em>£</em><input id="ciAmt" inputmode="decimal" value="${s.varies ? "" : (s.amount || "")}" placeholder="${usualAmt(s)}" aria-label="Amount that arrived"></div>
        <button class="btn good" type="submit">It arrived</button>
        <button class="btn ghost" type="button" id="ciLater">Not yet</button>
        <button class="btn ghost" type="button" id="ciSkip">It's not coming</button>
      </form>
      ${pend.length > 1 ? `<p class="hint muted" style="margin:var(--s3) 0 0">${pend.length - 1} more to check after this.</p>` : ""}
    </details>`;
    $("#ciForm").onsubmit = e => {
      e.preventDefault();
      const raw = $("#ciAmt").value.trim(), a = num(raw || String(usualAmt(s)));
      if (!(a > 0)) return toast("Enter the amount that arrived, e.g. 1850");
      const tx = {id: uid6(), type: "income", amount: r2(a), cat: s.id, srcId: s.id, forDate: p.date, note: "", date: p.date, created: Date.now()};
      box.dataset.key = "";
      writeMonth(p.date.slice(0, 7), items => { items.push(tx); return items; });
      toast(`${money(a)} from ${s.name} landed. Your balance just went up`, true);
      const bl = $("#balanceLine"); bl.classList.add("up"); setTimeout(() => bl.classList.remove("up"), 1600);
      if (s.type === "family" || s.freq === "oneoff") setTimeout(() => offerJob(a, "gift"), 700);
      else if (a > usualAmt(s) + 1) setTimeout(() => offerJob(a - usualAmt(s), "extra"), 700);
    };
    $("#ciLater").onclick = () => { box.dataset.key = ""; saveState({...state, snoozed: {...(state.snoozed || {}), [p.key]: today()}}); };
    $("#ciSkip").onclick = () => {
      if (!confirm(`Mark this ${s.name} payment as not coming?`)) return;
      box.dataset.key = ""; saveState({...state, skipped: {...(state.skipped || {}), [p.key]: true}});
    };
  }

  // windfalls: give surprise money a job before it becomes spending money
  let jobAmount = 0;
  function offerJob(amount, why) {
    const g = state && state.goal;
    if (!g || !g.name || !g.target) return;
    jobAmount = r2(amount);
    $("#jobTitle").textContent = why === "gift" ? "Give this money a job" : "You got paid more than usual";
    $("#jobText").textContent = why === "gift"
      ? `Money that arrives as a gift or one-off is the easiest to spend without noticing. Decide now how much of this ${money(amount)} goes to ${g.name}.`
      : `That's ${money(amount)} above your usual pay. Extra money is the easiest to lose track of, so decide now how much goes to ${g.name}.`;
    $("#jobLbl").textContent = `Put towards ${g.name}`;
    $("#jobAmt").value = r2(Math.round(amount / 2));
    $("#jobDlg").showModal();
  }
  function saveToGoal(a) {
    const goal = state.goal, t = today();
    const tx = {id: uid6(), type: "save", amount: r2(a), cat: "savings", note: "", date: t, created: Date.now()};
    writeMonth(t.slice(0, 7), items => { items.push(tx); return items; });
    saveState({...state, goal: {...goal, saved: r2((goal.saved || 0) + a)}});
    const pctNow = Math.min(100, Math.round(((goal.saved || 0) + a) / goal.target * 100));
    toast(`Nice. ${money(a)} saved, you're ${pctNow}% of the way to ${goal.name}`, true);
  }
  $("#jobForm").addEventListener("submit", e => {
    e.preventDefault();
    const a = num($("#jobAmt").value);
    if (!(a > 0)) return toast("Enter an amount to save, or choose Keep it to spend");
    $("#jobDlg").close(); saveToGoal(Math.min(a, jobAmount));
  });
  $("#jobKeep").onclick = () => $("#jobDlg").close();

  // add / edit income sources
  let editingIncome = null;
  function syncIncomeForm() {
    const f = $("#iFreq").value, varies = document.querySelector('input[name="iVar"]:checked').value === "varies";
    const needDate = !["monthly-lastworking", "monthly-lastfri"].includes(f);
    $("#iDateWrap").hidden = !needDate;
    $("#iDateLbl").textContent = f === "oneoff" ? "When do you expect it?" : f === "monthly-date" ? "Next pay date (sets the day of the month)" : "Next pay date";
    $("#iFixedWrap").hidden = varies; $("#iVarWrap").hidden = !varies; $("#iVarHint").hidden = !varies;
    $("#iMainWrap").hidden = f === "oneoff";
  }
  let incomeMode = "regular";
  function openIncome(id, mode) {
    if (!db) return toast("Open this page in Claude to add income.");
    if (!state) return toast("Finish setting up first.");
    const s = incomes().find(x => x.id === id);
    editingIncome = s ? s.id : null;
    incomeMode = s ? (s.freq === "oneoff" ? "oneoff" : "regular") : (mode || "regular");
    const one = incomeMode === "oneoff";
    $("#incTitle").textContent = s ? (one ? "Edit expected money" : "Edit income") : (one ? "Add expected one-off money" : "Add regular income");
    $("#iName").placeholder = one ? "e.g. Sam paying me back" : "e.g. Pharmacy";
    $("#iName").value = s ? s.name : "";
    $("#iType").value = s ? s.type : (one ? "family" : "work");
    $("#iFreq").value = s ? s.freq : (one ? "oneoff" : "monthly-lastworking");
    $("#iDate").value = s ? (s.date || (s.day ? isoD(new Date(+today().slice(0, 4), +today().slice(5, 7) - 1, s.day)) : "")) : "";
    document.querySelector(`input[name="iVar"][value="${s && s.varies ? "varies" : "fixed"}"]`).checked = true;
    $("#iAmt").value = s && !s.varies ? s.amount : "";
    $("#iLow").value = s && s.varies ? s.low : "";
    $("#iTyp").value = s && s.varies ? (s.typical || "") : "";
    $("#iMain").checked = s ? !!s.main : !incomes().some(x => x.main);
    $("#iFreq").closest(".field").hidden = one;
    $("#iVarQ").textContent = one ? "Do you know the exact amount?" : "Is it the same amount every time?";
    $("#iVarA").textContent = one ? "Yes, exactly" : "Same every time";
    $("#iVarB").textContent = one ? "Roughly" : "It changes";
    $("#iAmtLbl").textContent = one ? "Amount" : "Amount after tax";
    $("#iDate").min = one && !s ? today() : "";
    $("#iDelete").hidden = !s;
    syncIncomeForm();
    $("#incomeDlg").showModal();
  }
  $("#iFreq").onchange = syncIncomeForm;
  document.querySelectorAll('input[name="iVar"]').forEach(r => r.onchange = syncIncomeForm);
  $("#addIncome").onclick = () => openIncome(null, "regular");
  $("#addOneOff").onclick = () => openIncome(null, "oneoff");
  document.addEventListener("click", e => { if (e.target.closest("[data-add-income]")) openIncome(null); });
  $("#incomeList").addEventListener("click", e => { const li = e.target.closest("[data-edit-income]"); if (li) openIncome(li.dataset.editIncome); });
  $("#oneOffList").addEventListener("click", e => { const li = e.target.closest("[data-edit-income]"); if (li) openIncome(li.dataset.editIncome); });
  $("#incomeList").addEventListener("keydown", e => { const li = e.target.closest("[data-edit-income]"); if (li && e.key === "Enter") openIncome(li.dataset.editIncome); });
  $("#iCancel").onclick = () => $("#incomeDlg").close();
  $("#iDelete").onclick = () => {
    if (!editingIncome || !confirm("Remove this income source? Money you've already logged from it stays.")) return;
    saveState({...state, incomes: incomes().filter(x => x.id !== editingIncome)});
    $("#incomeDlg").close(); toast("Income removed");
  };
  $("#incForm").addEventListener("submit", e => {
    e.preventDefault();
    const name = $("#iName").value.trim();
    if (!name) return toast("Give this income a name, e.g. Pharmacy");
    const freq = $("#iFreq").value, varies = document.querySelector('input[name="iVar"]:checked').value === "varies";
    const date = $("#iDate").value;
    if (!["monthly-lastworking", "monthly-lastfri"].includes(freq) && !date) return toast("Add the next date this money arrives");
    const old = incomes().find(x => x.id === editingIncome);
    const src = {id: editingIncome || "i" + uid6(), name: name.slice(0, 40), type: $("#iType").value, freq, varies, since: (old && old.since) || today()};
    if (freq === "oneoff" && date && date < src.since) src.since = date;
    if (["weekly", "fortnightly", "fourweekly", "oneoff"].includes(freq)) src.date = date;
    if (freq === "monthly-date") src.day = parseD(date).getDate();
    if (varies) {
      const lo = num($("#iLow").value), ty = num($("#iTyp").value);
      if (!(lo >= 0) || Number.isNaN(lo)) return toast("Enter the lowest amount you'd expect");
      src.low = r2(lo); src.typical = Number.isNaN(ty) ? r2(lo) : r2(Math.max(ty, lo));
    } else {
      const a = num($("#iAmt").value);
      if (!(a > 0)) return toast("Enter how much arrives each time, after tax");
      src.amount = r2(a);
    }
    src.main = freq !== "oneoff" && $("#iMain").checked;
    let list = incomes().filter(x => x.id !== src.id);
    if (src.main) list = list.map(x => ({...x, main: false}));
    const idx = incomes().findIndex(x => x.id === src.id);
    if (idx >= 0) list.splice(idx, 0, src); else list.push(src);
    const next = {...state, incomes: list};
    if (!next.planStart) next.planStart = today().slice(0, 7);
    saveState(next);
    $("#incomeDlg").close();
    toast(idx >= 0 ? "Income updated" : freq === "oneoff" ? `${name} added. We'll ask on ${niceDate(date)} whether it arrived` : `${name} added. Your payday is worked out from it now`, idx < 0);
  });

  /* ---------- events ---------- */
  document.addEventListener("change", e => { if (e.target.name === "kind") render(); });

  $("#addForm").addEventListener("submit", e => {
    e.preventDefault();
    if (!db) return toast("Open this page in Claude to save transactions.");
    if (!state) return toast("Finish setting up first.");
    const a = num($("#fAmt").value);
    if (!(a > 0)) return toast("Enter an amount, e.g. 12.50");
    const kind = document.querySelector('input[name="kind"]:checked').value;
    const date = $("#fDate").value || today();
    const tx = {id: uid6(), type: kind, amount: r2(a), cat: $("#fCat").value, note: $("#fNote").value.trim().slice(0, 80), date, created: Date.now()};
    writeMonth(date.slice(0, 7), items => { items.push(tx); return items; });
    $("#fAmt").value = ""; $("#fNote").value = ""; $("#addDlg").close();
    if (kind === "income") {
      toast(`${money(a)} received. Your balance just went up`, true);
      const src = incomes().find(x => x.id === tx.cat);
      if (tx.cat === "gift" || (src && (src.type === "family" || src.freq === "oneoff"))) setTimeout(() => offerJob(a, "gift"), 700);
      else if (src && a > usualAmt(src) + 1) setTimeout(() => offerJob(a - usualAmt(src), "extra"), 700);
      const bl = $("#balanceLine"); bl.classList.add("up"); setTimeout(() => bl.classList.remove("up"), 1600);
    } else {
      const cc = calc(), ct = cc.cats.find(x => x.id === tx.cat);
      const spentNow = (cc.spent[tx.cat] || 0) + (date.slice(0, 7) === cc.cur ? a : 0);
      if (ct && ct.fixed && ct.budget && spentNow >= ct.budget && spentNow <= ct.budget + 0.01) toast(`${ct.name} paid on time`, true);
      else if (ct && !ct.fixed && ct.budget && spentNow <= ct.budget) toast(`Logged. Still ${money(ct.budget - spentNow)} left for ${ct.name}`, true);
      else toast(`Spent ${money(a)} added`);
    }
  });

  const onDel = e => {
    const b = e.target.closest("[data-del]"); if (!b) return;
    const id = b.dataset.del, cur = today().slice(0, 7);
    const it = (months[cur] || []).find(x => x.id === id);
    if (!it || !confirm(`Delete this ${money(it.amount)} transaction?`)) return;
    writeMonth(cur, items => items.filter(x => x.id !== id));
    if (it.type === "save" && state.goal) saveState({...state, goal:{...state.goal, saved:r2(Math.max(0, (state.goal.saved || 0) - it.amount))}});
  };
  $("#txList").addEventListener("click", onDel);
  $("#todayList").addEventListener("click", onDel);

  /* settings */
  const dlg = $("#settings");
  function catRow(x) {
    return `<div class="catrow" data-id="${esc(x.id)}">
      <input type="text" value="${esc(x.name)}" aria-label="Category name" class="cName">
      <div class="money"><em>£</em><input value="${x.budget || ""}" inputmode="decimal" aria-label="Monthly budget" class="cBudget" placeholder="0"></div>
      <label><input type="checkbox" class="cFixed" ${x.fixed ? "checked" : ""}> Bill</label>
      <button type="button" class="x btn ghost small" data-rm aria-label="Remove ${esc(x.name)}" style="padding:0;width:34px">×</button></div>`;
  }
  function openSettings() {
    if (!db) return toast("Open this page in Claude to change settings.");
    if (!state) return toast("Finish setting up first.");
    const c = calc();
    $("#sBal").value = c.balance == null ? "" : r2(c.balance);
    const auto = incomes().length > 0;
    $("#sPay").disabled = auto;
    $("#sPay").value = auto ? (c.payday || "") : (state.nextPayday || "");
    $("#sPay").title = auto ? "Worked out from your income" : "";
    $("#sGoalName").value = (state.goal && state.goal.name) || "";
    $("#sGoalTarget").value = (state.goal && state.goal.target) || "";
    $("#catRows").innerHTML = (state.categories || []).map(catRow).join("");
    dlg.showModal();
  }
  document.addEventListener("click", e => { if (e.target.closest("[data-open-settings]")) openSettings(); });
  $("#openSettings").onclick = openSettings;
  $("#cancelSet").onclick = () => dlg.close();
  $("#addCat").onclick = () => {
    $("#catRows").insertAdjacentHTML("beforeend", catRow({id: "c" + uid6(), name: "", budget: 0, fixed: false}));
    $("#catRows").lastElementChild.querySelector(".cName").focus();
  };
  $("#catRows").addEventListener("click", e => { const b = e.target.closest("[data-rm]"); if (b) b.closest(".catrow").remove(); });
  $("#setForm").addEventListener("submit", e => {
    e.preventDefault();
    const c = calc();
    const next = {...state};
    const bRaw = $("#sBal").value.trim();
    if (bRaw) {
      const b = num(bRaw);
      if (Number.isNaN(b)) return toast("Enter your balance as a number, e.g. 1250.50");
      if (c.balance == null || r2(b) !== r2(c.balance)) { next.balance = r2(b); next.balanceSetAt = Date.now(); next.balanceAsOf = today(); }
    }
    if (!$("#sPay").disabled) next.nextPayday = $("#sPay").value || null;
    const gt = num($("#sGoalTarget").value);
    next.goal = {...(state.goal || {saved:0}), name: $("#sGoalName").value.trim(), target: Number.isNaN(gt) ? 0 : r2(gt)};
    next.categories = [...document.querySelectorAll(".catrow")].map(r => ({
      id: r.dataset.id,
      name: r.querySelector(".cName").value.trim(),
      budget: (v => Number.isNaN(v) ? 0 : r2(v))(num(r.querySelector(".cBudget").value)),
      fixed: r.querySelector(".cFixed").checked
    })).filter(x => x.name);
    saveState(next); syncMonths();
    dlg.close(); toast("Settings saved");
  });



  /* ---------- looks ---------- */
  const LOOKS = [
    ["yellow", "Pale yellow", "#FFE27A"], ["green", "Apple green", "#34C759"], ["vibrant", "Vibrant green", "#00DC5A"],
    ["grass", "Grass green", "#4CE01A"], ["yellowgreen", "Yellow-green", "#8EE000"], ["lime", "Lime", "#ADFF3F"], ["mint", "Mint green", "#C4F5E1"],
    ["aberration", "Chromatic", "linear-gradient(90deg,#ff005a 0 18%,#fff 18% 82%,#00beff 82%)"],
    ["glow", "Prismatic glow", "conic-gradient(from 210deg,#ff7ac6,#ffcf6e,#8dffb8,#6ecbff,#b18cff,#ff7ac6)"]
  ];
  let accent = "yellow";
  try { accent = localStorage.getItem("accent") || "yellow"; } catch (e) {}
  function applyAccent(a, save) {
    if (!LOOKS.some(l => l[0] === a)) a = "yellow";
    accent = a;
    document.documentElement.setAttribute("data-accent", a);
    document.querySelectorAll(".look").forEach(b => b.setAttribute("aria-checked", b.dataset.look === a));
    if (save) {
      try { localStorage.setItem("accent", a); } catch (e) {}
      if (db && state && state.accent !== a) saveState({...state, accent: a});
    }
  }
  $("#looks").innerHTML = LOOKS.map(([id, name, sw]) =>
    `<button type="button" class="look" role="radio" data-look="${id}" aria-checked="false"><span class="sw" style="background:${sw}"></span>${name}</button>`).join("");
  $("#looks").addEventListener("click", e => { const b = e.target.closest(".look"); if (b) applyAccent(b.dataset.look, true); });
  applyAccent(accent, false);

  /* ---------- theme ---------- */
  const MOON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>';
  const SUN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
  function applyTheme(mode) {
    document.documentElement.setAttribute("data-mode", mode);
    const b = $("#themeBtn");
    b.innerHTML = mode === "dark" ? SUN : MOON;
    b.setAttribute("aria-label", mode === "dark" ? "Switch to light mode" : "Switch to dark mode");
  }
  let mode = "light";
  try { mode = localStorage.getItem("theme") === "dark" ? "dark" : "light"; } catch (e) {}
  applyTheme(mode);
  $("#themeBtn").onclick = () => {
    mode = mode === "dark" ? "light" : "dark";
    applyTheme(mode);
    try { localStorage.setItem("theme", mode); } catch (e) {}
  };

  /* ---------- boot ---------- */
  $("#fDate").value = today();
  render();
  (async () => {
    if (!window.claude || !window.claude.use) {
      $("#hero").innerHTML = `<p class="sub">Open this page in Claude to load and save your money data.</p>`;
      return;
    }
    const [d, user] = await Promise.all([window.claude.use("db"), window.claude.use("user")]);
    uid = user ? await user.id() : null;
    if (!d || !uid) {
      $("#hero").innerHTML = `<p class="sub">Your data can't load in this view. Sign in to Claude and open the page again.</p>`;
      return;
    }
    db = d;
    if (user && typeof user.me === "function") Promise.resolve().then(() => user.me()).then(m => { me = m || null; renderAcct(); }).catch(() => {});
    window.claude.use("mcp").then(m => { mcp = m; }).catch(() => {});
    stateRef = db.doc(`data/users/${uid}/state`);
    stateRef.onSnapshot(s => {
      state = s.exists ? s.data() : null;
      loaded = true;
      if (state && state.accent && state.accent !== accent) applyAccent(state.accent, false);
      syncMonths(); render();
    }, () => { $("#hero").innerHTML = `<p class="sub">Your data stopped loading. Reload the page to reconnect.</p>`; });
  })();
})();
