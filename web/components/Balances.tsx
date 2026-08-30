"use client";

import { useEffect, useState } from "react";
import { RpcProvider } from "starknet";
import { STRK_DECIMALS, config, formatUnits } from "@/lib/config";
import { useWallet } from "@/components/WalletProvider";

/**
 * What the connected wallet can spend in the open.
 *
 * A plain ERC-20 `balanceOf`, answering the question a bidder actually has: can I cover
 * the escrow and the fee on the public rail. It needs no permission and discloses
 * nothing — this balance is already public on chain.
 *
 * Its shielded counterpart is not here. That one is a disclosure, so it is opt-in and
 * lives beside the button that asks for it, in the wallet panel. The two used to sit
 * together in the topbar under a `@media (max-width: 720px) { display: none }`, which
 * meant a phone showed no balance at all.
 */
export function PublicBalance() {
  const { connection } = useWallet();
  const [strk, setStrk] = useState<bigint | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!connection) return;
    let live = true;
    const read = async () => {
      try {
        const p = new RpcProvider({ nodeUrl: config.rpcUrl });
        const r = await p.callContract({
          contractAddress: config.strkAddress,
          entrypoint: "balanceOf",
          calldata: [connection.address],
        });
        if (!live) return;
        setStrk(BigInt(r[0]!) + (BigInt(r[1] ?? 0) << 128n));
        setFailed(false);
      } catch {
        if (live) setFailed(true);
      }
    };
    void read();
    const t = setInterval(read, 30_000);
    return () => { live = false; clearInterval(t); };
  }, [connection]);

  if (!connection) return null;

  return (
    <p className="acct-bal-num">
      {failed ? <span className="undisclosed">unavailable</span>
        : strk === null ? "…"
        : `${formatUnits(strk, STRK_DECIMALS, 2)} STRK`}
    </p>
  );
}
