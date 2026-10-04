"use client";

import { useEffect, useState } from "react";
import { provider } from "@/lib/chain";
import { readNftImage } from "@/lib/nftImage";

/** The NFT's own image from its collection's metadata, or a plain line when it has none. */
export function NftImage({ collection, tokenId, size = 160 }: { collection: string; tokenId: bigint; size?: number }) {
  const [src, setSrc] = useState<string | null | undefined>(undefined);
  const [broken, setBroken] = useState(false);
  useEffect(() => {
    let live = true;
    setSrc(undefined); setBroken(false);
    void readNftImage(provider(), collection, tokenId).then((s) => { if (live) setSrc(s); }).catch(() => { if (live) setSrc(null); });
    return () => { live = false; };
  }, [collection, tokenId]);
  if (src === undefined) return <p className="note">Reading the collection’s metadata…</p>;
  if (src === null || broken) return <p className="note">The collection’s metadata has no image for this token.</p>;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- any host the metadata names
    <img src={src} alt={`Token #${tokenId.toString()}`} referrerPolicy="no-referrer" onError={() => setBroken(true)}
         style={{ width: size, height: size, objectFit: "cover", borderRadius: 8, border: "1px solid var(--line)", background: "var(--hatch-bg)", display: "block" }} />
  );
}
