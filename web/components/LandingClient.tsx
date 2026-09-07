"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Status } from "@vickrey/client";
import { fromWire, readAll, type AuctionView, type WireAuction } from "@/lib/chain";
import { config, isDeployed } from "@/lib/config";
import { HowItWorks } from "@/components/Hero";
import { LpHero } from "@/components/landing/Hero";
import { initMotion, onReplayKey, replayMotion } from "@/lib/motion";
import { watchBackdrop, watchGlow, watchScroll } from "@/lib/chrome";
import { watchReveals } from "@/lib/reveal";
import { AuctionCard } from "@/components/AuctionCard";
import { Faq } from "@/components/Faq";
import { LpFooter } from "@/components/landing/Footer";
import { Nav } from "@/components/landing/Nav";
import { LpProblem } from "@/components/landing/Problem";
import { useNow } from "@/components/WalletProvider";

/**
 * The landing page explains. It does not operate.
 *
 * The live auction list and the bid panel used to live here, which made the marketing
 * page and the application the same screen — the pitch had a transaction button halfway
 * down it. Bidding now lives on `/auction/[id]` and the dashboard; this page carries
 * three cards and a link, and its job ends at getting someone to one of them.
 */
export default function LandingClient({ initial }: { initial: WireAuction[] }) {
  const router = useRouter();
  const now = useNow();
  const seeded = useMemo(() => initial.map(fromWire), [initial]);
  const [all, setAll] = useState<AuctionView[]>(seeded);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [motionKey, setMotionKey] = useState(0);

  const replay = useCallback(() => {
    setMotionKey((k) => k + 1);
    setPlaying(replayMotion());
  }, []);

  useEffect(() => {
    setPlaying(initMotion());
    const offKey = onReplayKey(replay);
    const offScroll = watchScroll();
    const offGlow = watchGlow();
    const offBack = watchBackdrop();
    const offReveal = watchReveals();
    return () => { offKey(); offScroll(); offGlow(); offBack(); offReveal(); };
  }, [replay]);

  /* The server rendered the book into the HTML. This is a refresh because state moves,
     not a first load — the instrument never waits on it to draw. */
  useEffect(() => {
    if (!isDeployed()) return;
    (async () => {
      try { const views = await readAll(); if (views.length) setAll(views); }
      catch (e) { setLoadError(e instanceof Error ? e.message : String(e)); }
    })();
  }, []);

  /** Lead with a settled auction — it is the one that proves the claim. */
  const showcase = useMemo(
    () => all.find((a) => a.status === Status.Finalized)
       ?? all.find((a) => a.status === Status.Settled) ?? null,
    [all],
  );

  /** Three at most: open first, then the most recently settled. */
  const featured = useMemo(() => {
    const open = all.filter((a) => a.status === Status.Open);
    const done = all.filter((a) => a.status === Status.Settled || a.status === Status.Finalized).reverse();
    return [...open, ...done].slice(0, 3);
  }, [all]);

  const goBid = useCallback(() => {
    const open = all.find((a) => a.status === Status.Open);
    if (open) router.push(`/auction/${open.terms.auctionId}`);
    else router.push("/auctions");
  }, [all, router]);

  const goSettled = useCallback(() => {
    if (showcase) router.push(`/auction/${showcase.terms.auctionId}`);
    else router.push("/auctions");
  }, [showcase, router]);

  return (
    <>
      <div className="lp-bg" aria-hidden="true" />
      <Nav />
      {/* The nav floats over the top of the page, so the page starts below it. */}
      <main className="lp-main tw:mx-auto tw:max-w-7xl tw:px-4 tw:pt-24 tw:lg:pt-32">

      <LpHero
        all={all} showcase={showcase} playing={playing} motionKey={motionKey} loadError={loadError}
        onReplay={replay} goBid={goBid} goSettled={goSettled}
        onOpen={() => { if (showcase) router.push(`/auction/${showcase.terms.auctionId}`); }}
      />

      <LpProblem />
      <HowItWorks />

      <div className="spread" style={{ marginTop: "3rem", marginBottom: ".9rem" }}>
        <h2 className="section" id="auctions" style={{ margin: 0 }} data-reveal>Live auctions</h2>
        <Link className="note" href="/auctions">View all auctions →</Link>
      </div>

      {!isDeployed() ? (
        <div className="banner">
          <b>No contract configured for {config.label}.</b> Set{" "}
          <span className="mono">NEXT_PUBLIC_AUCTION_ADDRESS</span> and{" "}
          <span className="mono">NEXT_PUBLIC_ANONYMIZER_ADDRESS</span>. The repo README
          carries the honest status of every piece.
        </div>
      ) : featured.length === 0 ? (
        <div className="banner">
          <b>No auctions listed yet</b> on {config.label}. Nothing has been created against
          this contract.
        </div>
      ) : (
        <div className="cards" data-reveal>
          {featured.map((a) => (
            <AuctionCard
              key={a.terms.auctionId.toString()} auction={a} now={now} selected={false}
              onSelect={() => router.push(`/auction/${a.terms.auctionId}`)}
            />
          ))}
        </div>
      )}

      <Faq />
      </main>
      <LpFooter />
    </>
  );
}
