import { describe, expect, it } from "vitest";
import { byteArrayFelts } from "@/lib/v2";
import { imageFrom, inlineJson, resolveUri, uriFromFelts } from "@/lib/nftImage";

describe("reading an NFT's image from its metadata", () => {
  it("decodes a ByteArray token URI", () => {
    const uri = "https://example.org/meta/1042.json";
    expect(uriFromFelts(byteArrayFelts(uri).map(String))).toBe(uri);
  });

  it("decodes an older felt-array token URI", () => {
    const short = (s: string) => `0x${[...s].map((c) => c.charCodeAt(0).toString(16).padStart(2, "0")).join("")}`;
    expect(uriFromFelts(["0x2", short("ipfs://Qm"), short("abc/1.json")])).toBe("ipfs://Qmabc/1.json");
  });

  it("sends ipfs and arweave through https gateways", () => {
    expect(resolveUri("ipfs://Qmabc/1.png")).toBe("https://ipfs.io/ipfs/Qmabc/1.png");
    expect(resolveUri("ipfs://ipfs/Qmabc")).toBe("https://ipfs.io/ipfs/Qmabc");
    expect(resolveUri("ar://xyz")).toBe("https://arweave.net/xyz");
  });

  it("reads inline JSON, base64 or plain", () => {
    const meta = { name: "x", image: "data:image/svg+xml;base64,PHN2Zy8+" };
    expect(inlineJson(`data:application/json;base64,${btoa(JSON.stringify(meta))}`)).toEqual(meta);
    expect(inlineJson(`data:application/json,${encodeURIComponent(JSON.stringify(meta))}`)).toEqual(meta);
    expect(inlineJson("https://example.org/1.json")).toBeNull();
    /* As on-chain collections write it: ";utf8", raw, with a "%" that is not an escape. */
    const raw = 'data:application/json;utf8,{"name":"Warlock","image":"data:image/svg+xml;utf8,<svg width=\\"100%\\"/>"}';
    expect(imageFrom(inlineJson(raw))).toBe('data:image/svg+xml;utf8,<svg width="100%"/>');
  });

  it("shows only https and inline images", () => {
    expect(imageFrom({ image: "ipfs://Qmabc" })).toBe("https://ipfs.io/ipfs/Qmabc");
    expect(imageFrom({ image_url: "https://x.org/a.png" })).toBe("https://x.org/a.png");
    expect(imageFrom({ image: "http://x.org/a.png" })).toBeNull();
    expect(imageFrom({ image: "javascript:alert(1)" })).toBeNull();
    expect(imageFrom({ name: "no image" })).toBeNull();
    expect(imageFrom(null)).toBeNull();
  });
});
