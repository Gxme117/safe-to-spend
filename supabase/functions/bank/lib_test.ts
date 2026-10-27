import {allowedBack, authUrl, backWith, packState, readState, tokenForm} from "./lib.ts";

const eq = (a: unknown, b: unknown) => {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${JSON.stringify(a)} !== ${JSON.stringify(b)}`);
};
const CB = "https://ref.supabase.co/functions/v1/bank/callback";

Deno.test("a login only goes back into the app", () => {
  eq(allowedBack("moneytracker://bank"), true);
  eq(allowedBack("exp://192.168.1.2:8081/--/bank?n=1"), true);
  eq(allowedBack("https://evil.example"), false);
  eq(allowedBack("javascript:alert(1)"), false);
  eq(allowedBack("moneytracker://"), false);
});

Deno.test("the app's address survives the trip through state", () => {
  const back = "exp://u.ngrok.dev/--/bank?n=a+b/c";
  eq(readState(packState(back)), back);
  eq(/^[A-Za-z0-9_-]+$/.test(packState(back)), true);
});

Deno.test("a state that isn't ours, or points elsewhere, is refused", () => {
  eq(readState(null), null);
  eq(readState("not base64 !!"), null);
  eq(readState(packState("https://evil.example")), null);
});

Deno.test("sandbox logs in at the Mock bank, live at every UK bank", () => {
  const s = new URL(authUrl("sandbox", "id", CB, "moneytracker://bank"));
  eq(s.origin, "https://auth.truelayer-sandbox.com");
  eq(s.searchParams.get("providers"), "uk-cs-mock");
  eq(s.searchParams.get("redirect_uri"), CB);
  eq(s.searchParams.get("scope"), "info accounts balance transactions offline_access");
  eq(readState(s.searchParams.get("state")), "moneytracker://bank");
  const l = new URL(authUrl("live", "id", CB, "moneytracker://bank"));
  eq(l.origin, "https://auth.truelayer.com");
  eq(l.searchParams.get("providers"), "uk-ob-all uk-oauth-all");
});

Deno.test("the code goes back added to the app's address", () => {
  eq(backWith("moneytracker://bank", {code: "x/y"}), "moneytracker://bank?code=x%2Fy");
  eq(backWith("exp://h/--/bank?n=1", {error: "access_denied"}), "exp://h/--/bank?n=1&error=access_denied");
});

Deno.test("the token form: a code the first time, a refresh token after", () => {
  const a = tokenForm("id", "sh", CB, {code: "c"});
  eq([a.get("grant_type"), a.get("code"), a.get("redirect_uri"), a.get("client_secret")], ["authorization_code", "c", CB, "sh"]);
  const r = tokenForm("id", "sh", CB, {refresh_token: "r"});
  eq([r.get("grant_type"), r.get("refresh_token"), r.get("redirect_uri")], ["refresh_token", "r", null]);
});
