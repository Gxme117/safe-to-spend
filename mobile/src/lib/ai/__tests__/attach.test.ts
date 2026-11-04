import {blocksOf, MAX_ATTACH, MAX_PDF, MAX_TEXT, MAX_TOTAL, readFrom, shownOf, tooMuch, unreadIn, type Attachment} from "../attach";

const photo: Attachment = {kind: "image", name: "IMG_1.jpg", data: "aGk=", thumb: "data:image/jpeg;base64,aGk="};
const pdf: Attachment = {kind: "pdf", name: "Council tax.pdf", data: "JVBERi0="};
const csv: Attachment = {kind: "text", name: "march.csv", data: "date,amount\n2026-03-02,86.20\n"};

test("each becomes what Claude reads: a photo, a PDF, a text file as a document", () => {
  expect(blocksOf([photo, pdf, csv])).toEqual([
    {type: "image", source: {type: "base64", media_type: "image/jpeg", data: "aGk="}},
    {type: "document", source: {type: "base64", media_type: "application/pdf", data: "JVBERi0="}, title: "Council tax.pdf"},
    {type: "document", source: {type: "text", media_type: "text/plain", data: csv.data}, title: "march.csv"},
  ]);
});

test("only what's needed to show it is kept on your bubble", () => {
  expect(shownOf([photo, pdf])).toEqual([{kind: "image", name: "IMG_1.jpg", thumb: photo.thumb}, {kind: "pdf", name: "Council tax.pdf"}]);
});

test("limits: how many, how big, and all of a question together, each said plainly", () => {
  expect(tooMuch([], photo)).toBeNull();
  expect(tooMuch(Array(MAX_ATTACH).fill(photo), photo)).toBe("Up to 4 at a time.");
  expect(tooMuch([], {...pdf, data: "x".repeat(MAX_PDF + 1)})).toBe("Council tax.pdf is too big. PDFs up to 5 MB.");
  expect(tooMuch([], {...csv, data: "x".repeat(MAX_TEXT + 1)})).toBe("march.csv is too big. Text files up to 200 KB.");
  const big = {...photo, data: "x".repeat(MAX_TOTAL / 2 + 1)};
  expect(tooMuch([big], big)).toBe("That's more than fits in one question.");
});

test("what in a conversation only Claude could read: a photo first, else a PDF; a text file is read here", () => {
  const msg = (a: Attachment[]) => ({role: "user" as const, content: [{type: "text" as const, text: "Hi"}, ...blocksOf(a)]});
  expect(unreadIn([msg([csv])])).toBeNull();
  expect(unreadIn([msg([pdf])])).toBe("file");
  expect(unreadIn([msg([pdf]), msg([photo])])).toBe("photo");
  expect(unreadIn([{role: "user", content: "plain"}])).toBeNull();
});

test("the line under an answer whose figures come only from it", () => {
  expect(readFrom(["£42.99"], "photo")).toBe("Read from your photo, not checked against your numbers: £42.99.");
});
