import type { AuctionView } from "@/lib/chain";
import { formatUnits } from "@/lib/config";
import { LotKind } from "@/lib/v2";

/** The lot in a few words: "100 VLOT", "Collection #1042", or the off-chain item's name. */
export function lotText(a: AuctionView, offchainWhat?: string | null): string {
  if (a.lotKind === LotKind.Erc721) {
    return `${a.lotName || (a.lotSymbol !== "tokens" && a.lotSymbol) || "NFT"} #${a.lotTokenId.toString()}`;
  }
  if (a.lotKind === LotKind.OffChain) return offchainWhat || "Off-chain item";
  return `${formatUnits(a.lotAmount, a.lotDecimals)} ${a.lotSymbol}`;
}
