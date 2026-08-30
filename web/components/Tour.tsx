"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { TOUR_EVENT, markTourSeen, tourSeen } from "@/lib/tour";

/**
 * The first run, once.
 *
 * Everything here is something the interface cannot teach by being looked at. A queue of
 * obligations is unusual enough that its *purpose* needs saying; claim secrets living in
 * one browser is a property nobody assumes; and the choice between two rails is a
 * privacy decision made before the bid, where the cost of guessing wrong is permanent.
 *
 * Five steps, and it does not point at the screen. A spotlight would have to anchor to
 * elements that mostly live on other routes — claim secrets on /app/bids, the rails on an
 * auction page — and a tour that highlights two real things and describes three others is
 * more confusing than one that consistently describes. Each step links to where the thing
 * actually is instead.
 *
 * Skippable at every step and remembered either way: someone who skips has decided, and
 * asking again would be overruling them. The wallet menu can replay it, which is the only
 * route back.
 */
const STEPS = [
  {
    eyebrow: "Why this screen exists",
    title: "Some steps here can be missed silently",
    body: (
      <>
        <p>
          This protocol has steps with deadlines, and missing one produces{" "}
          <b>no error</b> — nothing reverts, nothing warns. It just quietly costs you
          something later.
        </p>
        <p className="note">
          So the dashboard leads with a queue of what needs you, and every entry says what
          happens if you miss it. Nothing appears there until it can actually be done, so
          nothing in it can refuse.
        </p>
      </>
    ),
  },
  {
    eyebrow: "Where obligations live",
    title: "The bell counts what is open",
    body: (
      <>
        <p>
          The bell in the top bar carries the same queue, on every page. It turns red when
          something closes within the hour.
        </p>
        <p className="note">
          Each item shows a countdown <b>and</b> an absolute UTC time — one to convey
          urgency, the other because a countdown cannot be quoted in a dispute.
        </p>
      </>
    ),
  },
  {
    eyebrow: "The thing that is unrecoverable",
    title: "Your claim secrets are in this browser only",
    body: (
      <>
        <p>
          Placing a bid generates a secret that is the <b>only</b> thing which can release
          its escrow. It is not on the chain, not on a server, and not recoverable by us —
          the same property that keeps your bid sealed keeps it unrecoverable.
        </p>
        <p className="note">
          Clearing site data or switching browser ends it. Export a copy from{" "}
          <Link href="/app/bids">My bids</Link> and keep it where you would keep a key.
        </p>
      </>
    ),
  },
  {
    eyebrow: "A choice made before you bid",
    title: "Two rails, and they reveal different things",
    body: (
      <>
        <p>
          The <b>public rail</b> sends escrow from your own address. Your bid amount stays
          sealed either way — but the address appears beside the transfer.
        </p>
        <p className="note">
          The <b>private rail</b> routes through the STRK20 pool, so no address appears at
          all. It needs a shielded balance you create in your wallet first, and it costs a
          pool fee. Public is the ordinary path; that is honest rather than modest.
        </p>
      </>
    ),
  },
  {
    eyebrow: "That is the whole of it",
    title: "Everything else the screen will tell you",
    body: (
      <>
        <p>
          Every action button explains what it does and what it costs before you press it,
          and every price on this site is a rung on a published ladder — never a free
          number.
        </p>
        <p className="note">
          You can replay this from the wallet menu at any time. The full reference is in{" "}
          <Link href="/docs">the docs</Link>.
        </p>
      </>
    ),
  },
] as const;

export function Tour() {
  const [open, setOpen] = useState(false);
  const [i, setI] = useState(0);

  /* First paint must not show it — `tourSeen` cannot read localStorage during SSR, and
     an effect is the only honest place to decide. */
  useEffect(() => { if (!tourSeen()) setOpen(true); }, []);

  useEffect(() => {
    const replay = () => { setI(0); setOpen(true); };
    window.addEventListener(TOUR_EVENT, replay);
    return () => window.removeEventListener(TOUR_EVENT, replay);
  }, []);

  const close = useCallback(() => {
    /* Remembered whether it was finished or skipped. Skipping is a decision. */
    markTourSeen();
    setOpen(false);
  }, []);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      if (e.key === "ArrowRight") setI((n) => Math.min(n + 1, STEPS.length - 1));
      if (e.key === "ArrowLeft") setI((n) => Math.max(n - 1, 0));
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, close]);

  if (!open || typeof document === "undefined") return null;

  const step = STEPS[i]!;
  const last = i === STEPS.length - 1;

  return createPortal(
    <div className="tour-veil" role="dialog" aria-modal="true" aria-label="Getting started">
      <div className="tour">
        <div className="tour-top">
          <p className="eyebrow">{step.eyebrow}</p>
          <button className="tour-skip" onClick={close}>
            {last ? "Close" : "Skip"}
          </button>
        </div>

        <h2 className="tour-title">{step.title}</h2>
        <div className="tour-body">{step.body}</div>

        <div className="tour-foot">
          <ol className="tour-dots" aria-label={`Step ${i + 1} of ${STEPS.length}`}>
            {STEPS.map((s, n) => (
              <li key={s.title}>
                <button
                  className={n === i ? "on" : n < i ? "done" : ""}
                  aria-label={`Step ${n + 1}: ${s.title}`}
                  aria-current={n === i ? "step" : undefined}
                  onClick={() => setI(n)}
                />
              </li>
            ))}
          </ol>
          <div className="tour-move">
            {i > 0 && <button onClick={() => setI(i - 1)}>Back</button>}
            <button className="primary" onClick={() => (last ? close() : setI(i + 1))}>
              {last ? "Start using it" : "Next"}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
