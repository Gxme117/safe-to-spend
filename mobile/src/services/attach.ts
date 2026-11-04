// The "+" card's Camera, Photos and Files: what you choose, made into what Tim and Frank read (lib/ai/attach.ts). Photos are
// made smaller first (Claude reads up to 1568px on the long side anyway), as JPEG, so a question with a few stays small.
import {getDocumentAsync} from "expo-document-picker";
import {File} from "expo-file-system";
import {ImageManipulator, SaveFormat} from "expo-image-manipulator";
import {launchCameraAsync, launchImageLibraryAsync, requestCameraPermissionsAsync, type ImagePickerAsset} from "expo-image-picker";
import {MAX_ATTACH, type Attachment} from "@/lib/ai/attach";

const LONG = 1568, THUMB = 160;

/** What came of a pick: what to add (none if you cancelled), or why not, in a sentence. */
export type Picked = {add: Attachment[]} | {reason: string};

// a photo at Claude's size (never made bigger), and a small one for your bubble. A size of 0 (a file's): measured first
async function photo(uri: string, w: number, h: number, name: string): Promise<Attachment> {
  if (!w || !h) ({width: w, height: h} = await ImageManipulator.manipulate(uri).renderAsync());
  const side = (n: number) => w >= h ? {width: Math.min(n, w)} : {height: Math.min(n, h)};
  const big = await (await ImageManipulator.manipulate(uri).resize(side(LONG)).renderAsync()).saveAsync({base64: true, compress: 0.7, format: SaveFormat.JPEG});
  const small = await (await ImageManipulator.manipulate(uri).resize(side(THUMB)).renderAsync()).saveAsync({base64: true, compress: 0.6, format: SaveFormat.JPEG});
  return {kind: "image", name, data: big.base64 ?? "", thumb: `data:image/jpeg;base64,${small.base64 ?? ""}`};
}
const fromAsset = (a: ImagePickerAsset) => photo(a.uri, a.width, a.height, a.fileName ?? "Photo");

/** A photo from the camera. */
export async function fromCamera(): Promise<Picked> {
  const ok = await requestCameraPermissionsAsync().catch(() => null);
  if (!ok?.granted) return {reason: "Pinch can't use the camera. You can allow it in Settings."};
  try {
    const r = await launchCameraAsync({mediaTypes: ["images"], quality: 1});
    return {add: r.canceled ? [] : await Promise.all(r.assets.map(fromAsset))};
  } catch {
    return {reason: "There's no camera to use here."};
  }
}

/** Photos from your library (up to `room`). The picker asks for no permission: you choose what it sees. */
export async function fromPhotos(room = MAX_ATTACH): Promise<Picked> {
  try {
    const r = await launchImageLibraryAsync({mediaTypes: ["images"], allowsMultipleSelection: room > 1, selectionLimit: room, quality: 1});
    return {add: r.canceled ? [] : await Promise.all(r.assets.slice(0, room).map(fromAsset))};
  } catch {
    return {reason: "Those photos couldn't be opened."};
  }
}

const TEXT = /\.(csv|txt|tsv)$/i;

/** A file: a PDF, a photo, or a CSV or text file. */
export async function fromFiles(room = MAX_ATTACH): Promise<Picked> {
  try {
    const r = await getDocumentAsync({type: ["application/pdf", "image/*", "text/plain", "text/csv", "text/comma-separated-values", "text/tab-separated-values"], multiple: room > 1, copyToCacheDirectory: true});
    if (r.canceled) return {add: []};
    const add: Attachment[] = [];
    for (const a of r.assets.slice(0, room)) {
      const file = new File(a.uri), mime = a.mimeType ?? "";
      if (mime === "application/pdf" || /\.pdf$/i.test(a.name)) add.push({kind: "pdf", name: a.name, data: await file.base64()});
      else if (mime.startsWith("image/")) add.push(await photo(a.uri, 0, 0, a.name));
      else if (mime.startsWith("text/") || TEXT.test(a.name)) add.push({kind: "text", name: a.name, data: await file.text()});
      else return {reason: `${a.name} isn't a kind of file they can read. PDFs, photos, CSV and text files.`};
    }
    return {add};
  } catch {
    return {reason: "That file couldn't be opened."};
  }
}
