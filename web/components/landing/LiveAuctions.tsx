"use client";

import Link from "next/link";
import type { AuctionView } from "@/lib/chain";
import { config, isDeployed } from "@/lib/config";
import { AuctionCard } from "@/components/AuctionCard";

/**
 * Three auctions at most — open first, then the most recently settled — each carrying
 * a thumbnail of its own ladder, so a visitor sees the whole idea before clicking
 * anything: one ladder wholly hatched, one cut by a single line.
 *
 * The cards are the app's own AuctionCard, restyled for this ground in landing.css.
 * The sentence under the heading is the one the auctions page opens with.
 */
const NOTE = "tw:mx-auto tw:mt-10 tw:max-w-2xl tw:rounded-2xl tw:border tw:border-dashed tw:border-neutral-300 tw:bg-white tw:p-6 tw:text-sm tw:text-neutral-600";

export function LpLiveAuctions({ featured, now, onOpen }: {
  featured: AuctionView[];
  now: number;
  onOpen: (a: AuctionView) => void;
}) {
  return (
    <section id="auctions" data-anchor className="tw:p-0 tw:py-10 tw:lg:py-20" aria-labelledby="auctions-h">
      <h2
        id="auctions-h" data-reveal data-beat="auctions"
        className="tw:mx-auto tw:max-w-5xl tw:text-center tw:text-3xl tw:font-medium tw:tracking-tight tw:text-balance tw:md:text-5xl tw:md:leading-tight"
      >
        Live auctions
      </h2>
      <p data-reveal className="tw:mx-auto tw:my-4 tw:max-w-4xl tw:text-center tw:text-sm tw:text-neutral-600 tw:text-balance tw:md:text-base">
        Every auction on {config.label}, in every state. No wallet needed to read any of it —
        the bid amounts are not hidden from you, they are not on the chain at all.
      </p>

      {!isDeployed() ? (
        <div className={NOTE} data-reveal>
          <b className="tw:font-semibold tw:text-black">No contract configured for {config.label}.</b> Set{" "}
          <span className="tw:font-mono">NEXT_PUBLIC_AUCTION_ADDRESS</span> and{" "}
          <span className="tw:font-mono">NEXT_PUBLIC_ANONYMIZER_ADDRESS</span>. The repo README
          carries the honest status of every piece.
        </div>
      ) : featured.length === 0 ? (
        <div className={NOTE} data-reveal>
          <b className="tw:font-semibold tw:text-black">No auctions listed yet</b> on {config.label}. Nothing has been
          created against this contract.
        </div>
      ) : (
        /* Centred and capped rather than a three-column grid: with two auctions a grid
           leaves a hole, and with three the cards are the same width either way. */
        <div className="tw:mt-10 tw:flex tw:flex-wrap tw:justify-center tw:gap-4" data-reveal>
          {featured.map((a) => (
            <div key={a.terms.auctionId.toString()} className="tw:flex tw:w-full tw:max-w-sm">
              <AuctionCard auction={a} now={now} selected={false} onSelect={() => onOpen(a)} />
            </div>
          ))}
        </div>
      )}

      <p data-reveal className="tw:mt-8 tw:text-center tw:text-sm tw:text-neutral-600">
        <Link href="/auctions" className="tw:inline-flex tw:items-center tw:max-lg:min-h-11">View all auctions &rarr;</Link>
      </p>
    </section>
  );
}
