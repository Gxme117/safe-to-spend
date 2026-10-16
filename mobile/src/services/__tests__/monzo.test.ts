import {approvedYet, connect, disconnect, fetchBank, MonzoFail, saveClient} from "@/services/monzo";

const mockKeychain = new Map<string, string>();
jest.mock("expo-secure-store", () => ({
  getItemAsync: async (k: string) => mockKeychain.get(k) ?? null,
  setItemAsync: async (k: string, v: string) => { mockKeychain.set(k, v); },
  deleteItemAsync: async (k: string) => { mockKeychain.delete(k); },
}));

const res = (status: number, body: unknown = {}) => ({ok: status < 300, status, json: async () => body}) as Response;
const tokens = (n: number) => res(200, {access_token: `a${n}`, refresh_token: `r${n}`, expires_in: 3600});
const fetchMock = jest.fn();
globalThis.fetch = fetchMock;

beforeEach(async () => {
  mockKeychain.clear(); fetchMock.mockReset();
  await saveClient("cid", "secret");
});

const bankReplies = () => [
  res(200, {accounts: [{id: "old", closed: true}, {id: "acc"}]}),
  res(200, {balance: 12345}),
  res(200, {pots: [{id: "p", name: "Pot", balance: 500}]}),
  res(200, {transactions: [{id: "tx1", amount: -250, created: "2026-10-03T09:00:00Z"}]}),
];
const SINCE = "2026-10-01T00:00:00Z";

test("connects, then reads the open account's balance and pots", async () => {
  fetchMock.mockResolvedValueOnce(tokens(1));
  await connect("code");
  expect(String(fetchMock.mock.calls[0][1].body)).toContain("grant_type=authorization_code");
  expect(String(fetchMock.mock.calls[0][1].body)).toContain("client_secret=secret");
  for (const r of bankReplies()) fetchMock.mockResolvedValueOnce(r);
  await expect(fetchBank(SINCE)).resolves.toEqual({
    accountId: "acc", mainPence: 12345, pots: [{id: "p", name: "Pot", balance: 500}],
    txs: [{id: "tx1", amount: -250, created: "2026-10-03T09:00:00Z"}],
  });
  expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe("Bearer a1");
  expect(fetchMock.mock.calls[2][0]).toContain("/balance?account_id=acc");
  expect(fetchMock.mock.calls[4][0]).toContain(`/transactions?account_id=acc&since=${SINCE}`);
  expect(fetchMock.mock.calls[4][0]).toContain("expand[]=merchant");
});

test("approval in the Monzo app is noticed: 403 until then, and other failures still say what went wrong", async () => {
  fetchMock.mockResolvedValueOnce(tokens(1));
  await connect("code");
  fetchMock.mockResolvedValueOnce(res(403));
  await expect(approvedYet()).resolves.toBe(false);
  fetchMock.mockResolvedValueOnce(res(200, {accounts: []}));
  await expect(approvedYet()).resolves.toBe(true);
  fetchMock.mockRejectedValueOnce(new Error("no signal"));
  await expect(approvedYet()).rejects.toMatchObject({kind: "offline"});
});

test("a busy month is read 100 at a time, carrying on from the last one", async () => {
  fetchMock.mockResolvedValueOnce(tokens(1));
  await connect("code");
  const page = Array.from({length: 100}, (_, i) => ({id: `t${i}`, amount: -1, created: "2026-10-02T09:00:00Z"}));
  const [accs, bal, pots] = bankReplies();
  fetchMock.mockResolvedValueOnce(accs).mockResolvedValueOnce(bal).mockResolvedValueOnce(pots)
    .mockResolvedValueOnce(res(200, {transactions: page}))
    .mockResolvedValueOnce(res(200, {transactions: [{id: "last", amount: -1, created: "2026-10-03T09:00:00Z"}]}));
  const got = await fetchBank(SINCE);
  expect(got.txs).toHaveLength(101);
  expect(fetchMock.mock.calls[5][0]).toContain("since=t99");
});

test("an expired token is refreshed, and the new refresh token kept", async () => {
  fetchMock.mockResolvedValueOnce(tokens(1));
  await connect("code");
  fetchMock.mockResolvedValueOnce(res(401)).mockResolvedValueOnce(tokens(2));
  for (const r of bankReplies()) fetchMock.mockResolvedValueOnce(r);
  await fetchBank(SINCE);
  expect(String(fetchMock.mock.calls[2][1].body)).toContain("refresh_token=r1");
  expect(mockKeychain.get("monzo.refresh")).toBe("r2");
  expect(fetchMock.mock.calls[3][1].headers.Authorization).toBe("Bearer a2");
});

test("before you approve in the Monzo app, it says so", async () => {
  fetchMock.mockResolvedValueOnce(tokens(1));
  await connect("code");
  fetchMock.mockResolvedValueOnce(res(403));
  await expect(fetchBank(SINCE)).rejects.toMatchObject({kind: "needs-approval"});
});

test("a refused refresh means logging in again; no network means offline", async () => {
  fetchMock.mockResolvedValueOnce(tokens(1));
  await connect("code");
  fetchMock.mockResolvedValueOnce(res(401)).mockResolvedValueOnce(res(401));
  await expect(fetchBank(SINCE)).rejects.toMatchObject({kind: "needs-login"});
  fetchMock.mockRejectedValueOnce(new TypeError("Network request failed"));
  await expect(fetchBank(SINCE)).rejects.toBeInstanceOf(MonzoFail);
});

test("disconnecting forgets everything", async () => {
  fetchMock.mockResolvedValueOnce(tokens(1));
  await connect("code");
  await disconnect();
  expect(mockKeychain.size).toBe(0);
});

test("a wrong client secret is told apart from a used-up link", async () => {
  fetchMock.mockResolvedValueOnce(res(400, {code: "bad_request.could_not_authenticate"}));
  await expect(connect("code")).rejects.toMatchObject({kind: "bad-client"});
  fetchMock.mockResolvedValueOnce(res(401, {code: "unauthorized.bad_authorization_code"}));
  await expect(connect("code")).rejects.toMatchObject({kind: "needs-login"});
});
