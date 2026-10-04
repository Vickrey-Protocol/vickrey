/**
 * An NFT's image, from its collection's metadata: `token_uri` (or `tokenURI`), then the
 * JSON it points to, then that JSON's `image`. Every step can fail on a collection we
 * don't control, and each failure is just "no image" — the listing never depends on it.
 *
 * Only https and inline data images are shown. An http image would be blocked on an
 * https page anyway, and nothing else is a picture.
 */
import { num, type RpcProvider } from "starknet";
import { decodeByteArray } from "@/lib/v2";

const IPFS = "https://ipfs.io/ipfs/";

/** A token URI comes back as a ByteArray, or from older collections as felt short strings. */
export function uriFromFelts(felts: string[]): string {
  const asText = (s: string) => s.replace(/\0/g, "").trim();
  try {
    const text = asText(decodeByteArray(felts));
    if (text && /^[\x20-\x7e]+$/.test(text)) return text;
  } catch { /* not a ByteArray */ }
  /* Array<felt252>: a length, then short strings to concatenate. */
  const parts = felts.slice(1).map((f) => {
    let hex = BigInt(f).toString(16);
    if (hex.length % 2) hex = `0${hex}`;
    return hex.match(/../g)?.map((h) => String.fromCharCode(parseInt(h, 16))).join("") ?? "";
  });
  return asText(parts.join(""));
}

/** ipfs:// and ar:// to their https gateways; anything else as it is. */
export function resolveUri(uri: string): string {
  if (uri.startsWith("ipfs://")) return IPFS + uri.slice(7).replace(/^ipfs\//, "");
  if (uri.startsWith("ar://")) return `https://arweave.net/${uri.slice(5)}`;
  return uri;
}

/** Inline JSON metadata, base64 or plain. Null when the URI is not inline JSON. */
export function inlineJson(uri: string): unknown {
  const m = uri.match(/^data:application\/json(;[^,]*)?,(.*)$/s);
  if (!m) return null;
  if (m[1]?.includes("base64")) return JSON.parse(atob(m[2]!));
  /* Plain text is meant to be URL-encoded, but on-chain collections often write it raw,
     where a stray "%" would make decoding throw. */
  try { return JSON.parse(decodeURIComponent(m[2]!)); } catch { return JSON.parse(m[2]!); }
}

/** The image a metadata object names, if it is one this page will show. */
export function imageFrom(meta: unknown): string | null {
  if (!meta || typeof meta !== "object") return null;
  const m = meta as Record<string, unknown>;
  const raw = [m.image, m.image_url, m.imageUrl].find((x) => typeof x === "string") as string | undefined;
  if (!raw) return null;
  const url = resolveUri(raw.trim());
  return /^https:\/\//.test(url) || /^data:image\//.test(url) ? url : null;
}

export async function readNftImage(p: RpcProvider, collection: string, tokenId: bigint): Promise<string | null> {
  const calldata = [num.toHex(tokenId & ((1n << 128n) - 1n)), num.toHex(tokenId >> 128n)];
  let felts: string[] | null = null;
  for (const entrypoint of ["token_uri", "tokenURI"]) {
    try { felts = await p.callContract({ contractAddress: collection, entrypoint, calldata }); break; }
    catch { /* try the other spelling */ }
  }
  if (!felts?.length) return null;
  const uri = resolveUri(uriFromFelts(felts));
  if (!uri) return null;
  try {
    const inline = inlineJson(uri);
    if (inline) return imageFrom(inline);
    if (!/^https:\/\//.test(uri)) return null;
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 8000);
    try {
      const res = await fetch(uri, { signal: ctl.signal, referrerPolicy: "no-referrer" });
      if (!res.ok) return null;
      return imageFrom(await res.json());
    } finally { clearTimeout(t); }
  } catch { return null; }
}
