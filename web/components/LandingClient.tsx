"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Status } from "@vickrey/client";
import { fromWire, readAll, type AuctionView, type WireAuction } from "@/lib/chain";
import { isDeployed } from "@/lib/config";
import { LpHero } from "@/components/landing/Hero";
import { LpHowItWorks } from "@/components/landing/HowItWorks";
import { LpProperties } from "@/components/landing/Properties";
import { LpLiveAuctions } from "@/components/landing/LiveAuctions";
import { initMotion, onReplayKey, replayMotion } from "@/lib/motion";
import { watchBackdrop, watchGlow, watchScroll } from "@/lib/chrome";
import { watchReveals } from "@/lib/reveal";
import { Faq } from "@/components/Faq";
import { LpFooter } from "@/components/landing/Footer";
import { Nav } from "@/components/landing/Nav";
import { Background } from "@/components/landing/Background";
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
      <Nav />
      {/* The template's shape: the background is absolute inside a relative wrapper,
          under a container that is itself positioned so it paints above it. */}
      <div className="tw:relative">
        <Background />
      <main className="lp-main tw:relative tw:mx-auto tw:max-w-7xl tw:px-4">

      <LpHero
        all={all} showcase={showcase} playing={playing} motionKey={motionKey} loadError={loadError}
        onReplay={replay} goBid={goBid} goSettled={goSettled}
        onOpen={() => { if (showcase) router.push(`/auction/${showcase.terms.auctionId}`); }}
      />

      <LpProblem />
      <LpHowItWorks />
      <LpProperties />

      <LpLiveAuctions featured={featured} now={now} onOpen={(a) => router.push(`/auction/${a.terms.auctionId}`)} />

      <Faq />
      </main>
      </div>
      <LpFooter />
    </>
  );
}
