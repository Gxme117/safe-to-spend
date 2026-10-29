import {AccountantFail, send} from "@/services/accountant";
import {accessToken} from "@/services/session";

const mockKeychain = new Map<string, string>();
jest.mock("expo-secure-store", () => ({
  getItemAsync: async (k: string) => mockKeychain.get(k) ?? null,
  setItemAsync: async (k: string, v: string) => { mockKeychain.set(k, v); },
  deleteItemAsync: async (k: string) => { mockKeychain.delete(k); },
}));

const res = (status: number, body: unknown = {}) => ({ok: status < 300, status, json: async () => body}) as Response;
const session = (n: number) => res(200, {access_token: `a${n}`, refresh_token: `r${n}`, expires_in: 3600});
const fetchMock = jest.fn();
globalThis.fetch = fetchMock;
const url = (i: number) => String(fetchMock.mock.calls[i][0]);
const turn = {content: [{type: "text", text: "£18 today."}], stop_reason: "end_turn"};
const q = [{role: "user" as const, content: "What can I spend?"}];

beforeEach(() => { mockKeychain.clear(); fetchMock.mockReset(); });

test("signs in anonymously once, then keeps using the token while it's fresh", async () => {
  fetchMock.mockResolvedValueOnce(session(1));
  expect(await accessToken()).toBe("a1");
  expect(url(0)).toBe("https://sgchailpcwkffckwnazp.supabase.co/auth/v1/signup");
  expect(fetchMock.mock.calls[0][1].headers.apikey).toMatch(/^sb_publishable_/);
  expect(await accessToken()).toBe("a1");
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

test("an old token is refreshed; a refresh that's turned down starts a new sign-in", async () => {
  fetchMock.mockResolvedValueOnce(session(1));
  await accessToken();
  fetchMock.mockResolvedValueOnce(session(2));
  expect(await accessToken(true)).toBe("a2");
  expect(url(1)).toContain("/auth/v1/token?grant_type=refresh_token");
  expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({refresh_token: "r1"});
  fetchMock.mockResolvedValueOnce(res(400)).mockResolvedValueOnce(session(3));
  expect(await accessToken(true)).toBe("a3");
  expect(url(3)).toContain("/auth/v1/signup");
});

test("sends the conversation with the token, and brings back Claude's turn", async () => {
  fetchMock.mockResolvedValueOnce(session(1)).mockResolvedValueOnce(res(200, turn));
  expect(await send("frank", q)).toEqual(turn);
  expect(url(1)).toBe("https://sgchailpcwkffckwnazp.supabase.co/functions/v1/accountant/chat");
  const init = fetchMock.mock.calls[1][1];
  expect(init.headers.Authorization).toBe("Bearer a1");
  expect(JSON.parse(init.body)).toEqual({who: "frank", messages: q});
});

test("a token the server doesn't know gets one more go with a new one", async () => {
  fetchMock.mockResolvedValueOnce(session(1)).mockResolvedValueOnce(res(401)).mockResolvedValueOnce(session(2)).mockResolvedValueOnce(res(200, turn));
  expect(await send("tim", q)).toEqual(turn);
  expect(fetchMock.mock.calls[3][1].headers.Authorization).toBe("Bearer a2");
});

const why = async () => { try { await send("tim", q); } catch (e) { return e instanceof AccountantFail ? e.kind : e; } return "answered"; };

test("what went wrong, as something he can say calmly", async () => {
  fetchMock.mockRejectedValueOnce(new TypeError("Network request failed"));
  expect(await why()).toBe("offline");
  // anonymous sign-ins switched off on the project
  fetchMock.mockResolvedValueOnce(res(422));
  expect(await why()).toBe("not-set-up");
  fetchMock.mockResolvedValueOnce(session(1)).mockResolvedValueOnce(res(429, {error: "busy"}));
  expect(await why()).toBe("busy");
  fetchMock.mockResolvedValueOnce(res(500, {error: "not_configured"}));
  expect(await why()).toBe("not-set-up");
  fetchMock.mockResolvedValueOnce(res(502, {error: "unavailable"}));
  expect(await why()).toBe("unavailable");
  fetchMock.mockResolvedValueOnce(res(200, {nothing: true}));
  expect(await why()).toBe("unavailable");
});

test("no answer in time: it gives up and says so", async () => {
  jest.useFakeTimers();
  try {
    fetchMock.mockResolvedValueOnce(session(1)).mockImplementationOnce((_u: string, init: RequestInit) => new Promise((_ok, no) => {
      init.signal!.addEventListener("abort", () => no(new Error("aborted")));
    }));
    const p = why();
    await jest.advanceTimersByTimeAsync(70_000);
    expect(await p).toBe("timeout");
  } finally {
    jest.useRealTimers();
  }
});
