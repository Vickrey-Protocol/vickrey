"use client";

import { useState } from "react";

/** The mainnet demo on YouTube. */
export const DEMO_ID = "Kk6CicIUVkc";
export const DEMO_URL = `https://www.youtube.com/watch?v=${DEMO_ID}`;
export const DEMO_LENGTH = "2:46";

/**
 * The demo, embedded lightly: until someone presses play this is a self-hosted thumbnail
 * and a button — no YouTube script, frame or cookie on load. The press swaps in the
 * youtube-nocookie player, which starts because the press asked it to; nothing plays on
 * its own. The thumbnail is lazy, so it costs nothing until the section is near.
 */
export function LpDemo() {
  const [playing, setPlaying] = useState(false);
  return (
    <section id="demo" data-anchor className="tw:p-0 tw:pt-20 tw:md:pt-28" aria-labelledby="demo-h">
      <h2
        id="demo-h" data-reveal
        className="tw:mx-auto tw:max-w-5xl tw:text-center tw:text-3xl tw:font-medium tw:tracking-tight tw:text-balance tw:md:text-5xl tw:md:leading-tight"
      >
        Watch a full mainnet run
      </h2>

      <div data-reveal className="tw:mx-auto tw:mt-10 tw:max-w-5xl tw:overflow-hidden tw:rounded-[24px] tw:border tw:border-neutral-200 tw:dark:border-neutral-700 tw:bg-neutral-100 tw:dark:bg-neutral-900 tw:p-2 tw:md:mt-14">
        <div className="tw:relative tw:aspect-video tw:w-full tw:overflow-hidden tw:rounded-[18px] tw:bg-black">
          {playing ? (
            <iframe
              className="tw:absolute tw:inset-0 tw:h-full tw:w-full tw:border-0"
              src={`https://www.youtube-nocookie.com/embed/${DEMO_ID}?autoplay=1&rel=0`}
              title="Vickrey v2 — full mainnet demo"
              allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture; fullscreen"
              referrerPolicy="strict-origin-when-cross-origin"
              allowFullScreen
            />
          ) : (
            <button
              type="button"
              onClick={() => setPlaying(true)}
              aria-label={`Play the demo video, ${DEMO_LENGTH}`}
              className="tw:group tw:absolute tw:inset-0 tw:block tw:h-full tw:w-full tw:cursor-pointer tw:border-0 tw:bg-transparent tw:p-0"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/demo/thumbnail-1280.jpg"
                srcSet="/demo/thumbnail-640.jpg 640w, /demo/thumbnail-1280.jpg 1280w"
                sizes="(min-width: 1024px) 1024px, 100vw"
                width={1280} height={720} loading="lazy" decoding="async" alt=""
                className="tw:h-full tw:w-full tw:object-cover tw:transition tw:duration-300 tw:group-hover:scale-[1.01]"
              />
              <span aria-hidden="true" className="tw:absolute tw:inset-0 tw:bg-black/10 tw:transition tw:group-hover:bg-black/20" />
              {/* Bottom-left, not centred: the thumbnail's point is the price on the ladder, and a
                  centred button sat on it. */}
              <span aria-hidden="true" className="tw:absolute tw:bottom-3 tw:left-3 tw:flex tw:items-center tw:gap-3 tw:rounded-full tw:bg-neutral-900/90 tw:py-2 tw:pl-2 tw:pr-5 tw:text-white tw:shadow-2xl tw:ring-2 tw:ring-white/60 tw:transition tw:group-hover:scale-[1.03] tw:md:bottom-6 tw:md:left-6 tw:md:py-3 tw:md:pl-3 tw:md:pr-6">
                <span className="tw:flex tw:h-10 tw:w-10 tw:items-center tw:justify-center tw:rounded-full tw:bg-white tw:md:h-14 tw:md:w-14">
                  <svg viewBox="0 0 24 24" className="tw:ml-0.5 tw:h-5 tw:w-5 tw:fill-neutral-900 tw:md:h-7 tw:md:w-7"><path d="M8 5.5v13l11-6.5z" /></svg>
                </span>
                <span className="tw:text-base tw:font-medium tw:md:text-xl">Play the demo</span>
                <span className="tw:font-mono tw:text-sm tw:opacity-70 tw:md:text-base">{DEMO_LENGTH}</span>
              </span>
            </button>
          )}
        </div>
      </div>

      <p data-reveal className="tw:mx-auto tw:mt-5 tw:max-w-3xl tw:text-center tw:text-base tw:text-neutral-600 tw:dark:text-neutral-300 tw:text-balance">
        One run on Starknet mainnet, start to finish: list, bid on both rails, seal, settle, collect.{" "}
        <a href={DEMO_URL} target="_blank" rel="noreferrer" className="tw:whitespace-nowrap tw:text-black tw:dark:text-white">Watch on YouTube ↗</a>
      </p>
    </section>
  );
}
