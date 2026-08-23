"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Status } from "@vickrey/client";
import { fromWire, readAll, type AuctionView, type WireAuction } from "@/lib/chain";
import { config, isDeployed } from "@/lib/config";
import { Ladder } from "@/components/Ladder";
import { Hero, HowItWorks } from "@/components/Hero";
import { initMotion, onReplayKey, replayMotion } from "@/lib/motion";
import { watchBackdrop, watchGlow, watchScroll } from "@/lib/chrome";
import { watchReveals } from "@/lib/reveal";
import { AuctionCard } from "@/components/AuctionCard";
import { Faq } from "@/components/Faq";
import { Footer } from "@/components/Footer";
import { HeroInstrument } from "@/components/HeroInstrument";
import { Masthead } from "@/components/Masthead";
import { Problem } from "@/components/Problem";
import { TrustStatement } from "@/components/TrustStatement";
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
    <main>
      <div className="backdrop" aria-hidden="true" />
      <Masthead />

      <div className="hero-grid">
        <div className="hero-left">
          <Hero />
          <div className="hero-cta" data-reveal style={{ ["--d" as string]: ".42s" }}>
            <button className="primary" onClick={goBid}>Place a sealed bid</button>
            <button onClick={goSettled}>See a settled auction</button>
          </div>

          {/* Live counts, read from chain. The last one is the point of the product and
              it is a fact, not a slogan. */}
          <dl className="hero-stats" data-reveal style={{ ["--d" as string]: ".54s" }}>
            <div><dt>Auctions</dt><dd>{all.length}</dd></div>
            <div><dt>Bids sealed</dt><dd>{all.reduce((n, a) => n + a.bidCount, 0)}</dd></div>
            <div><dt>Amounts disclosed</dt><dd className="zero">0</dd></div>
          </dl>
        </div>

        <div className="hero-right" data-reveal style={{ ["--d" as string]: ".22s" }}>
          {showcase ? (
            <HeroInstrument
              auction={showcase} playing={playing} motionKey={motionKey} onReplay={replay}
              onOpen={() => router.push(`/auction/${showcase.terms.auctionId}`)}
            />
          ) : (
            /* No auction to show. The instrument still draws its frame — R1 means the
               unknown values read as unknown, never as a placeholder number. */
            <div className="rig">
              <div className="rig-head"><span>No auction loaded</span></div>
              <div className="rig-ladder">
                <Ladder numLevels={12} reservePrice={0n} tick={0n} symbol=""
                        bidCount={0} status={Status.None} hideScale />
              </div>
              <div className="rig-readout">
                <div>
                  <div className="rig-lab">Clearing price</div>
                  <div className="fact"><span className="undisclosed">not disclosed</span></div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div className="rig-lab">Bids</div>
                  <div className="rig-bids undisclosed">—</div>
                </div>
              </div>
              <p className="note" style={{ marginTop: ".8rem" }}>
                {loadError ? `Could not read ${config.label}: ${loadError}` : `Reading ${config.label}…`}
              </p>
            </div>
          )}
        </div>

        {/* R2: both sentences, in full, inside the hero screen. */}
        <TrustStatement delay=".62s" />
      </div>

      <Problem />
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
      <Footer />
    </main>
  );
}
