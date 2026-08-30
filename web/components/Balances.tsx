"use client";

import { useEffect, useState } from "react";
import { RpcProvider } from "starknet";
import { STRK_DECIMALS, config, formatUnits } from "@/lib/config";
import { useWallet } from "@/components/WalletProvider";

/**
 * What the connected wallet can spend, and one thing this app will never show.
 *
 * The public balance is a plain ERC-20 read and answers the question a bidder actually
 * has: can I cover the escrow and the fee. The **shielded** balance is deliberately
 * absent — reading it requires a viewing key, and asking for one would give this app
 * sight of private state it has no business seeing. That is the same reason capability
 * is detected with a version compare rather than by probing `strk20Balances`.
 *
 * So the gap is labelled rather than left blank. A missing number with no explanation
 * reads as broken; a missing number with a reason reads as the product working.
 */
export function Balances() {
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
    <div className="bal">
      <span className="bal-item">
        <span className="bal-lab">Public</span>
        <span className="bal-num">
          {failed ? "unavailable" : strk === null ? "…" : `${formatUnits(strk, STRK_DECIMALS, 2)} STRK`}
        </span>
      </span>
      {/* The reason used to live in a `title`, which does not exist on touch — and this
          is one of the better things the product has to say about itself. It is on screen
          now, and expandable rather than truncated. */}
      <details className="bal-item bal-shielded">
        <summary>
          <span className="bal-lab">Shielded</span>
          <span className="bal-num undisclosed">not requested ⓘ</span>
        </summary>
        <p className="note">
          Reading a shielded balance needs a viewing key. This app never asks for one, so
          it cannot see your private balance — and neither can anyone reading this page.
        </p>
      </details>
    </div>
  );
}
