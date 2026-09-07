"use client";

import Link from "next/link";
import { Status } from "@vickrey/client";
import type { AuctionView } from "@/lib/chain";
import { config } from "@/lib/config";
import { HeroInstrument } from "@/components/HeroInstrument";
import { Ladder } from "@/components/Ladder";
import { TrustStatement } from "@/components/TrustStatement";
import { LpButton } from "./Button";

/**
 * The template's hero: a badge, a headline, one paragraph, two buttons, and the
 * product in a rounded frame. Ours puts the instrument in the frame — a real settled
 * auction read from chain, not a screenshot — because the hero should show the
 * argument, not the operator tool. It stays there after the dashboard redesign.
 *
 * The template faded the bottom of its frame into the page to hide a cropped
 * screenshot. The instrument is complete, so nothing here is faded.
 *
 * The template animated the headline in with a motion library, which left it
 * invisible until hydration. Every line here is real text in the HTML; `data-reveal`
 * moves what is already there, and if the script never runs it is all simply visible.
 *
 * No accent in the copy. The accent means one thing — a value that became public —
 * and the only such value on this screen is the clearing rung in the frame.
 */
export function LpHero({
  all, showcase, playing, motionKey, loadError, onReplay, onOpen, goBid, goSettled,
}: {
  all: AuctionView[];
  showcase: AuctionView | null;
  playing: boolean;
  motionKey: number;
  loadError: string | null;
  onReplay: () => void;
  onOpen: () => void;
  goBid: () => void;
  goSettled: () => void;
}) {
  const sealed = all.reduce((n, a) => n + a.bidCount, 0);
  const settled = all.filter((a) => a.status === Status.Settled || a.status === Status.Finalized).length;
  const badge = all.length
    ? `${config.label} · ${settled} settled · ${sealed} bids sealed · 0 amounts disclosed`
    : `${config.label} · nothing listed yet`;

  return (
    <section className="lp-hero tw:relative tw:flex tw:flex-col tw:items-center tw:p-0 tw:pt-6 tw:md:pt-14">
      {/* A live fact where the template put its funding round. */}
      <Link
        href="/auctions"
        data-reveal data-beat="hero-copy"
        className="tw:inline-flex tw:items-center tw:gap-2 tw:rounded-full tw:border tw:border-neutral-200 tw:bg-neutral-50 tw:px-4 tw:py-1.5 tw:font-mono tw:text-[11px] tw:uppercase tw:tracking-widest tw:text-neutral-600 tw:no-underline tw:shadow-aceternity tw:transition tw:hover:bg-white tw:max-lg:min-h-11"
      >
        {badge}
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M10.75 8.75L14.25 12l-3.5 3.25" /></svg>
      </Link>

      <h1 className="tw:relative tw:z-10 tw:mx-auto tw:mt-6 tw:max-w-6xl tw:text-center tw:text-4xl tw:font-semibold tw:tracking-tight tw:text-balance tw:md:text-6xl tw:lg:text-8xl">
        <span className="tw:block" data-reveal style={{ ["--d" as string]: ".05s" }}>The bids stay sealed.</span>
        <span className="tw:block" data-reveal style={{ ["--d" as string]: ".16s" }}>The price does not.</span>
      </h1>

      <p
        data-reveal style={{ ["--d" as string]: ".30s" }}
        className="tw:relative tw:z-10 tw:mx-auto tw:mt-6 tw:max-w-3xl tw:text-center tw:text-base tw:text-neutral-600 tw:text-balance tw:md:text-xl"
      >
        Highest bidder wins and pays the <strong className="tw:font-semibold tw:text-black">second-highest bid</strong>.
        The chain learns one number and nothing else — <strong className="tw:font-semibold tw:text-black">not even the winner&apos;s own bid</strong>.
      </p>

      <div data-reveal style={{ ["--d" as string]: ".42s" }} className="tw:relative tw:z-10 tw:mt-6 tw:flex tw:flex-wrap tw:items-center tw:justify-center tw:gap-4">
        <LpButton onClick={goBid}>Place a sealed bid</LpButton>
        <LpButton variant="simple" onClick={goSettled} className="tw:group">
          <span>See a settled auction</span>
          <svg className="tw:h-3 tw:w-3 tw:transition-transform tw:duration-200 tw:group-hover:translate-x-1" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
        </LpButton>
      </div>

      {/* Live counts, read from chain. The last one is the point of the product, and it
          is a fact rather than a slogan — so it is set like the other two, not in accent. */}
      <dl data-reveal style={{ ["--d" as string]: ".54s" }} className="tw:mt-10 tw:flex tw:flex-wrap tw:justify-center tw:gap-x-12 tw:gap-y-4">
        {[["Auctions", all.length], ["Bids sealed", sealed], ["Amounts disclosed", 0]].map(([k, v]) => (
          <div key={String(k)} className="tw:text-center">
            <dt className="tw:font-mono tw:text-[11px] tw:uppercase tw:tracking-widest tw:text-neutral-500">{k}</dt>
            <dd className="tw:m-0 tw:mt-1 tw:text-2xl tw:font-medium tw:tabular-nums">{v}</dd>
          </div>
        ))}
      </dl>

      <div
        data-reveal style={{ ["--d" as string]: ".22s" }}
        className="lp-frame tw:relative tw:mt-16 tw:w-full tw:rounded-[32px] tw:border tw:border-neutral-200 tw:bg-neutral-100 tw:p-3 tw:md:p-4"
      >
        <div className="tw:rounded-[24px] tw:border tw:border-neutral-200 tw:bg-white tw:p-2">
          {showcase ? (
            <HeroInstrument auction={showcase} playing={playing} motionKey={motionKey} onReplay={onReplay} onOpen={onOpen} />
          ) : (
            /* No auction to show. The instrument still draws its frame — R1 means the
               unknown values read as unknown, never as a placeholder number. */
            <div className="rig">
              <div className="rig-head"><span>No auction loaded</span></div>
              <div className="rig-ladder">
                <Ladder numLevels={12} reservePrice={0n} tick={0n} symbol="" bidCount={0} status={Status.None} hideScale />
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
      </div>

      {/* R2: both sentences, in full, inside the hero. */}
      <div className="tw:mt-6 tw:w-full"><TrustStatement delay=".62s" /></div>
    </section>
  );
}
