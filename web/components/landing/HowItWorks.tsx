"use client";

import Link from "next/link";
import { Status } from "@vickrey/client";
import { Ladder } from "@/components/Ladder";
import { Thermometer } from "@/components/docs/Thermometer";

/**
 * How it works, in the template's feature grid: a heading, four cards on a six-column
 * grid (4 + 2 over 3 + 3) with hairline borders between them and grid lines bleeding
 * past the edges, each card a title, a line of copy and an illustration.
 *
 * The template's illustrations were product screenshots animated in with a motion
 * library. Ours are the instrument itself: a ladder with a level picked, the seal →
 * seeds → settle timeline, the two hash chains, and the record that actually lands on
 * chain. None of them carries a fabricated number — the ladder has no price scale and
 * no bids, because R1 says a hidden value is never rendered as a number, and a made-up
 * one would be worse.
 *
 * Copy is the copy that stood before the redesign.
 */
const CARD = "tw:relative tw:overflow-hidden tw:p-4 tw:sm:p-8";
const TITLE = "tw:m-0 tw:text-left tw:text-xl tw:font-medium tw:tracking-tight tw:text-black tw:md:text-2xl tw:md:leading-snug";
const DESC = "tw:m-0 tw:my-2 tw:max-w-sm tw:text-left tw:text-sm tw:text-neutral-600 tw:md:text-base";

function Timeline() {
  const steps = [
    ["bids arrive", "two hashes and an escrow each"],
    ["seal()", "the set is frozen, the block stamped"],
    ["seeds move", "only now, and only to the auctioneer"],
    ["settle()", "N+1 witnesses, checked on chain"],
  ];
  return (
    <ol className="tw:m-0 tw:mt-6 tw:flex tw:list-none tw:flex-col tw:gap-0 tw:p-0" aria-label="The order of operations">
      {steps.map(([t, d], i) => (
        <li key={t} className="tw:relative tw:flex tw:gap-3 tw:pb-5 tw:pl-1 tw:last:pb-0">
          {i < steps.length - 1 && <span aria-hidden="true" className="tw:absolute tw:top-4 tw:bottom-0 tw:left-[0.9rem] tw:w-px tw:bg-neutral-200" />}
          <span aria-hidden="true" className={"tw:relative tw:z-10 tw:mt-1 tw:flex tw:h-6 tw:w-6 tw:flex-none tw:items-center tw:justify-center tw:rounded-full tw:border tw:bg-white tw:font-mono tw:text-[10px] " + (i === 1 ? "tw:border-black tw:text-black" : "tw:border-neutral-300 tw:text-neutral-500")}>{i + 1}</span>
          <span className="tw:flex tw:flex-col">
            <span className={"tw:font-mono tw:text-sm " + (i === 1 ? "tw:font-semibold tw:text-black" : "tw:text-neutral-800")}>{t}</span>
            <span className="tw:text-xs tw:text-neutral-500">{d}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}

/** What a bid is, as the chain sees it. The two things people expect are the two that are absent. */
function Record() {
  const rows: Array<[string, string, boolean]> = [
    ["up_anchor", "poseidon chain, ℓ steps", true],
    ["down_anchor", "poseidon chain, P−1−ℓ steps", true],
    ["escrow", "the top of the ladder — the same for everyone", true],
    ["amount", "never on chain", false],
    ["address", "never on the private rail", false],
  ];
  return (
    <dl className="tw:m-0 tw:mt-6 tw:overflow-hidden tw:rounded-xl tw:border tw:border-neutral-200 tw:bg-white tw:font-mono tw:text-xs tw:shadow-aceternity">
      {rows.map(([k, v, on]) => (
        <div key={k} className="tw:flex tw:items-baseline tw:justify-between tw:gap-4 tw:border-b tw:border-neutral-100 tw:px-4 tw:py-2.5 tw:last:border-0">
          <dt className={on ? "tw:text-black" : "tw:text-neutral-400 tw:line-through"}>{k}</dt>
          <dd className={"tw:m-0 tw:text-right " + (on ? "tw:text-neutral-600" : "tw:text-neutral-400")}>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function LpHowItWorks() {
  return (
    <section id="how" data-anchor className="tw:relative tw:z-20 tw:overflow-hidden tw:p-0 tw:py-10 tw:lg:py-40" aria-labelledby="how-h">
      <h2
        id="how-h" data-reveal data-beat="how"
        className="tw:mx-auto tw:max-w-5xl tw:text-center tw:text-3xl tw:font-medium tw:tracking-tight tw:text-balance tw:md:text-5xl tw:md:leading-tight"
      >
        How it works
      </h2>
      <p data-reveal className="tw:mx-auto tw:my-4 tw:max-w-4xl tw:text-center tw:text-sm tw:text-neutral-600 tw:text-balance tw:md:text-base">
        Pick a level. Two hash anchors go on chain — no amount, no address. The clearing
        price is proved while every bid stays sealed.
      </p>

      <div className="tw:relative">
        <div className="tw:mt-12 tw:grid tw:grid-cols-1 tw:lg:grid-cols-6">
          <div className={`${CARD} tw:border-b tw:border-neutral-200 tw:lg:col-span-4 tw:lg:border-r`} data-reveal>
            <h3 className={TITLE}>Bid</h3>
            <p className={DESC}>Pick a level on the ladder. Two hash anchors go on chain — no amount, no address.</p>
            <div className="lp-illus tw:mt-6 tw:flex tw:justify-center">
              <Ladder numLevels={8} reservePrice={0n} tick={0n} status={Status.Open} bidCount={0} pickedLevel={5} hideScale />
            </div>
          </div>
          <div className={`${CARD} tw:border-b tw:border-neutral-200 tw:lg:col-span-2`} data-reveal style={{ ["--d" as string]: ".08s" }}>
            <h3 className={TITLE}>Seal</h3>
            <p className={DESC}>The contract freezes the set and stamps the block. Only then do seeds move.</p>
            <Timeline />
          </div>
          <div className={`${CARD} tw:border-b tw:border-neutral-200 tw:lg:col-span-3 tw:lg:border-b-0 tw:lg:border-r`} data-reveal style={{ ["--d" as string]: ".16s" }}>
            <h3 className={TITLE}>Settle</h3>
            <p className={DESC}>N+1 witnesses prove the second price. Not one bid is opened.</p>
            <div className="lp-illus"><Thermometer levels={8} bid={4} /></div>
          </div>
          <div className={`${CARD} tw:lg:col-span-3`} data-reveal style={{ ["--d" as string]: ".24s" }}>
            <h3 className={TITLE}>What is on chain</h3>
            <p className={DESC}>
              A bid is <b className="tw:font-semibold tw:text-black">two hashes and an escrow</b>. The escrow is the same for everyone —
              the top of the ladder — so the amount you send says nothing about the amount
              you bid. Your address never appears beside a price, and on the private rail it
              never appears at all.
            </p>
            <Record />
          </div>
        </div>
        {/* The template bleeds these 10% past the grid; the section clips them at its
            edge anyway, and the bleed made the grid's box report a spill to the audit. The
            vertical pair keeps its bleed, which is the visible one — into the section's
            padding above and below. */}
        <div className="lp-gridline-h" style={{ top: 0, left: 0, width: "100%" }} aria-hidden="true" />
        <div className="lp-gridline-h" style={{ bottom: 0, left: 0, width: "100%" }} aria-hidden="true" />
        <div className="lp-gridline-v" style={{ top: "-10%", right: 0, height: "120%" }} aria-hidden="true" />
        <div className="lp-gridline-v" style={{ top: "-10%", left: 0, height: "120%" }} aria-hidden="true" />
      </div>

      <p data-reveal className="tw:mt-8 tw:flex tw:flex-wrap tw:justify-center tw:gap-x-8 tw:gap-y-2 tw:text-center tw:text-sm tw:text-neutral-600">
        <Link href="/auctions" className="tw:max-lg:min-h-11 tw:inline-flex tw:items-center">See a settled auction &rarr;</Link>
        <Link href="/docs" className="tw:max-lg:min-h-11 tw:inline-flex tw:items-center">
          The full reference — the six properties, the hash-chain construction, and what
          the STRK20 integration does and does not reveal &rarr;
        </Link>
      </p>
    </section>
  );
}
