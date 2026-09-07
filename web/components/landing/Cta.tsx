"use client";

import { Background } from "./Background";
import { LpButton } from "./Button";

/**
 * The template's closing card — a dark gradient panel on its own copy of the
 * background, a headline, a line, one button. The template's line invited you to a
 * waitlist; ours says where the contracts are and what has not been done to them,
 * in the FAQ's own words, because a call to action on an unaudited protocol should
 * carry its status.
 *
 * The template's grain was a webp; this one is an SVG turbulence filter inlined from
 * landing.css, so the page ships no image for it.
 */
export function LpCta({ onBid, network }: { onBid: () => void; network: string }) {
  return (
    <div className="tw:relative">
      <div className="tw:absolute tw:inset-0 tw:h-full tw:w-full tw:overflow-hidden"><Background /></div>
      <section className="tw:relative tw:z-30 tw:w-full tw:overflow-hidden tw:p-0 tw:py-40 tw:md:py-60" aria-labelledby="cta-h">
        <div className="tw:mx-auto tw:w-full tw:bg-linear-to-br tw:from-slate-800 tw:to-gray-900 tw:dark:from-neutral-900 tw:sm:max-w-[40rem] tw:sm:rounded-2xl tw:md:max-w-[48rem] tw:lg:max-w-[64rem] tw:xl:max-w-[80rem]" data-reveal data-beat="cta">
          {/* The template pulled this 1.5rem past its container's padding on phones; this card
              sits outside the container, so there is no padding to cancel and the pull
              was a 24px spill. */}
          <div className="tw:relative tw:overflow-hidden tw:px-6 tw:sm:rounded-2xl tw:md:px-8">
            <div aria-hidden="true" className="lp-noise tw:absolute tw:inset-0 tw:h-full tw:w-full tw:opacity-10 tw:[mask-image:radial-gradient(#fff,transparent,75%)]" />
            <div className="tw:relative tw:px-6 tw:pt-20 tw:pb-14 tw:sm:px-10 tw:sm:pb-20 tw:lg:px-[4.5rem]">
              <h2 id="cta-h" className="tw:mx-auto tw:text-center tw:text-3xl tw:font-semibold tw:tracking-[-0.015em] tw:text-white tw:text-balance tw:md:text-5xl">
                Place a sealed bid.
              </h2>
              <p className="tw:mx-auto tw:mt-4 tw:max-w-[26rem] tw:text-center tw:text-base/6 tw:text-neutral-200 tw:text-balance">
                The contracts are deployed to {network}. Nothing has been audited. The
                README carries the honest status of every piece.
              </p>
              <div className="tw:relative tw:z-10 tw:mx-auto tw:mt-6 tw:flex tw:justify-center">
                <LpButton onClick={onBid}>Place a sealed bid</LpButton>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
