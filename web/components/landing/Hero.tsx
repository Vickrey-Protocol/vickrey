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
 * The template's hero, to the letter: a badge, a headline, one paragraph, two
 * buttons, and the product in a rounded frame whose bottom melts into the page.
 *
 * In the frame is the instrument — a real settled auction read from chain — because
 * the hero should show the argument, not the operator tool. The template's fade
 * hides the cut edge of a screenshot; here it dissolves the bottom of the ladder,
 * which is the band of losing bids, so the readout sits top-right where nothing is
 * faded and the part that fades is the part that stays sealed.
 *
 * The template animated every line in with a motion library — y 40 → 0 (80 for the
 * buttons), half a second, eased out, staggered 0 / 0 / .2 / .4 — which left the
 * headline invisible until hydration. The same values run here as data-reveal on
 * text that is already in the HTML; without the script it is all simply visible.
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
  const badge = all.length
    ? `${all.length} auction${all.length === 1 ? "" : "s"} on ${config.label} · ${sealed} bids sealed · 0 amounts disclosed`
    : `${config.label} · nothing listed yet`;

  return (
    <section className="lp-hero tw:relative tw:flex tw:min-h-screen tw:flex-col tw:overflow-hidden tw:p-0 tw:pt-20 tw:md:pt-40">
      {/* The template's badge — a live fact where it put its funding round. */}
      <div className="tw:flex tw:justify-center" data-reveal data-beat="hero-copy">
        <Link
          href="/auctions"
          className="tw:group tw:relative tw:mx-auto tw:inline-block tw:w-fit tw:cursor-pointer tw:rounded-full tw:bg-neutral-50 tw:dark:bg-neutral-900 tw:p-px tw:text-[10px] tw:font-semibold tw:leading-6 tw:text-neutral-700 tw:dark:text-neutral-300 tw:no-underline tw:shadow-zinc-900 tw:sm:text-xs tw:md:shadow-2xl tw:max-lg:min-h-11 tw:max-lg:flex tw:max-lg:items-center"
        >
          <span className="tw:absolute tw:inset-0 tw:overflow-hidden tw:rounded-full" />
          <span className="tw:relative tw:z-10 tw:flex tw:items-center tw:space-x-2 tw:rounded-full tw:bg-neutral-100 tw:dark:bg-neutral-800 tw:px-4 tw:py-1.5 tw:ring-1 tw:ring-white/10">
            <span>{badge}</span>
            <svg fill="none" height="16" viewBox="0 0 24 24" width="16" aria-hidden="true"><path d="M10.75 8.75L14.25 12L10.75 15.25" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" /></svg>
          </span>
          <span className="tw:absolute tw:-bottom-0 tw:left-[1.125rem] tw:h-px tw:w-[calc(100%-2.25rem)] tw:bg-linear-to-r tw:from-neutral-400/0 tw:via-neutral-400/90 tw:to-neutral-400/0 tw:transition-opacity tw:duration-500 tw:group-hover:opacity-40" />
        </Link>
      </div>

      <h1
        data-reveal
        className="tw:relative tw:z-10 tw:mx-auto tw:mt-6 tw:max-w-6xl tw:text-center tw:text-2xl tw:font-semibold tw:text-balance tw:md:text-4xl tw:lg:text-8xl"
      >
        The bids stay sealed. The price does not.
      </h1>

      <p
        data-reveal style={{ ["--d" as string]: ".2s" }}
        className="tw:relative tw:z-10 tw:mx-auto tw:mt-6 tw:max-w-3xl tw:text-center tw:text-base tw:text-neutral-600 tw:dark:text-neutral-300 tw:text-balance tw:md:text-xl"
      >
        Highest bidder wins and pays the <strong className="tw:font-semibold tw:text-black tw:dark:text-white">second-highest bid</strong>.
        The chain learns one number and nothing else — <strong className="tw:font-semibold tw:text-black tw:dark:text-white">not even the winner&apos;s own bid</strong>.
      </p>

      <div
        data-reveal style={{ ["--d" as string]: ".4s" }}
        className="lp-hero-cta tw:relative tw:z-10 tw:mt-6 tw:flex tw:flex-wrap tw:items-center tw:justify-center tw:gap-4"
      >
        <LpButton onClick={goBid}>Place a sealed bid</LpButton>
        <LpButton variant="simple" onClick={goSettled} className="tw:group tw:flex tw:items-center tw:space-x-2">
          <span>See a settled auction</span>
          <svg className="tw:h-3 tw:w-3 tw:stroke-[1px] tw:text-neutral-600 tw:dark:text-neutral-300 tw:transition-transform tw:duration-200 tw:group-hover:translate-x-1" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
        </LpButton>
      </div>

      {/* Clipped: the fade below is scaled 1.1 as in the template, and a transformed box
          counts towards scrollable overflow — 37px past the frame at 768 — which the
          four-band audit reads as a spill. */}
      <div className="lp-frame tw:relative tw:mt-20 tw:overflow-hidden tw:rounded-[32px] tw:border tw:border-neutral-200 tw:dark:border-neutral-700 tw:bg-neutral-100 tw:dark:bg-neutral-800 tw:p-4">
        <div aria-hidden="true" className="tw:pointer-events-none tw:absolute tw:inset-x-0 tw:bottom-0 tw:z-10 tw:h-40 tw:w-full tw:scale-[1.1] tw:bg-linear-to-b tw:from-transparent tw:via-white tw:to-white tw:dark:via-black/50 tw:dark:to-black" />
        <div className="tw:rounded-[24px] tw:border tw:border-neutral-200 tw:dark:border-neutral-700 tw:bg-white tw:dark:bg-black tw:p-2">
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

      {/* R2: both sentences, in full, inside the hero. Ours, not the template's. */}
      <div className="tw:relative tw:z-10 tw:mt-6 tw:w-full"><TrustStatement delay=".6s" /></div>
    </section>
  );
}
