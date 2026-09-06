"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { TOUR_EVENT, markTourSeen, tourSeen } from "@/lib/tour";

/**
 * The first run, once — anchored to the thing being described wherever one exists.
 *
 * It began as five centred cards, on the reasoning that three of the five subjects live
 * on other routes and a tour that points at two while describing three reads as broken.
 * That objection was right and the conclusion was too weak: the fix is to *go* to the
 * route, not to stop pointing. Steps carry an anchor and the route it lives on, the tour
 * navigates when it has to, and the flow stays continuous.
 *
 * Two steps genuinely have nowhere to point, and they say so rather than pretending:
 * the rails only exist inside a bid panel on an open auction, which may not exist at all
 * on a fresh install, and the closing step is about the app rather than any part of it.
 * Those stay centred. Anchoring to something conditionally present would put the tour
 * back where it started — pointing at a gap.
 */
interface Step {
  eyebrow: string;
  title: string;
  body: React.ReactNode;
  /** `[data-tour]` value to highlight, when one exists on some route. */
  anchor?: string;
  /** Where that anchor lives. The tour navigates before looking for it. */
  route?: string;
  /** Why this step is centred, for the ones that are. */
  centredBecause?: string;
}

const STEPS: Step[] = [
  {
    eyebrow: "Why this screen exists",
    title: "Some steps here can be missed silently",
    anchor: "queue",
    route: "/app",
    body: (
      <>
        <p>
          This protocol has steps with deadlines, and missing one produces <b>no error</b>
          {" "}— nothing reverts, nothing warns. It just quietly costs you something later.
        </p>
        <p className="note">
          So the dashboard leads with this queue. Every entry says what happens if you
          miss it, and nothing appears until it can actually be done — so nothing listed
          can refuse.
        </p>
      </>
    ),
  },
  {
    eyebrow: "Where obligations live",
    title: "The bell counts what is open",
    anchor: "bell",
    route: "/app",
    body: (
      <>
        <p>
          The same queue, on every page, and it turns red when something closes within the
          hour.
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
    anchor: "vault",
    route: "/app/bids",
    body: (
      <>
        <p>
          Placing a bid generates a secret that is the <b>only</b> thing which can release
          its escrow. Not on the chain, not on a server, not recoverable by us — the same
          property that keeps your bid sealed keeps it unrecoverable.
        </p>
        <p className="note">
          Clearing site data or switching browser ends it. Export a copy and keep it where
          you would keep a key.
        </p>
      </>
    ),
  },
  {
    eyebrow: "A choice made before you bid",
    title: "Two rails, and they reveal different things",
    centredBecause:
      "the rails only exist inside a bid panel on an auction that is still open, so there "
      + "may be nothing to point at yet",
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
    centredBecause: "it is about the app rather than any one part of it",
    body: (
      <>
        <p>
          Every action button explains what it does and what it costs before you press it,
          and every price is a rung on a published ladder — never a free number.
        </p>
        <p className="note">
          You can replay this from the wallet menu at any time. The full reference is in{" "}
          <Link href="/docs">the docs</Link>.
        </p>
      </>
    ),
  },
];

/** Where the card sits relative to the anchor, and whether it fits. */
interface Spot { top: number; left: number; width: number; height: number }

export function Tour() {
  const [open, setOpen] = useState(false);
  const [i, setI] = useState(0);
  const [spot, setSpot] = useState<Spot | null>(null);
  /* True while we are navigating or waiting for an anchor to appear. Without it the card
     renders centred for a frame and then jumps, which reads as a glitch. */
  const [seeking, setSeeking] = useState(false);
  const router = useRouter();
  const path = usePathname();
  const card = useRef<HTMLDivElement>(null);

  const step = STEPS[i]!;
  const last = i === STEPS.length - 1;

  useEffect(() => { if (!tourSeen()) setOpen(true); }, []);
  useEffect(() => {
    const replay = () => { setI(0); setOpen(true); };
    window.addEventListener(TOUR_EVENT, replay);
    return () => window.removeEventListener(TOUR_EVENT, replay);
  }, []);

  const close = useCallback(() => { markTourSeen(); setOpen(false); setSpot(null); }, []);

  /* Navigate for a step whose anchor lives elsewhere. */
  useEffect(() => {
    if (!open || !step.route || path === step.route) return;
    setSpot(null);
    setSeeking(true);
    router.push(step.route);
  }, [open, i, step.route, path, router]);

  /**
   * Find the anchor and measure it, retrying while the route settles.
   *
   * A `router.push` resolves before the new page has painted, so the element is not there
   * on the first look. Polling briefly is the honest way to wait for it — and giving up
   * after a bounded number of tries means a missing anchor degrades to a centred card
   * rather than a tour that hangs.
   */
  useEffect(() => {
    if (!open) return;
    if (!step.anchor) { setSpot(null); setSeeking(false); return; }

    let tries = 0;
    let raf = 0;
    let timer: ReturnType<typeof setTimeout>;

    const measure = () => {
      const el = document.querySelector<HTMLElement>(`[data-tour="${step.anchor}"]`);
      if (el) {
        const r = el.getBoundingClientRect();
        setSpot({ top: r.top, left: r.left, width: r.width, height: r.height });
        setSeeking(false);
        el.scrollIntoView({ block: "center", behavior: "smooth" });
        return;
      }
      if (++tries > 30) { setSpot(null); setSeeking(false); return; }   // ~3s, then centre
      timer = setTimeout(measure, 100);
    };
    measure();

    /* Keep the highlight on the element while the page moves under it. */
    const track = () => {
      const el = document.querySelector<HTMLElement>(`[data-tour="${step.anchor}"]`);
      if (!el) return;
      const r = el.getBoundingClientRect();
      setSpot({ top: r.top, left: r.left, width: r.width, height: r.height });
    };
    const onMove = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(track); };
    window.addEventListener("scroll", onMove, true);
    window.addEventListener("resize", onMove);
    return () => {
      clearTimeout(timer);
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", onMove, true);
      window.removeEventListener("resize", onMove);
    };
  }, [open, i, step.anchor, path]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      if (e.key === "ArrowRight" && !last) setI((n) => n + 1);
      if (e.key === "ArrowLeft") setI((n) => Math.max(n - 1, 0));
    };
    window.addEventListener("keydown", onKey);
    card.current?.focus();
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, close, last]);

  if (!open || typeof document === "undefined") return null;

  /* Below the anchor when there is room, above it otherwise. Clamped so the card never
     leaves the viewport, which is what a naive "beside it" does at the edges. */
  const CARD_W = 380;
  const GAP = 14;
  let style: React.CSSProperties = {};
  if (spot) {
    const below = spot.top + spot.height + GAP;
    const roomBelow = window.innerHeight - below > 240;
    style = {
      position: "fixed",
      top: roomBelow ? below : undefined,
      bottom: roomBelow ? undefined : window.innerHeight - spot.top + GAP,
      left: Math.min(
        Math.max(12, spot.left + spot.width / 2 - CARD_W / 2),
        Math.max(12, window.innerWidth - CARD_W - 12),
      ),
      width: CARD_W,
    };
  }

  return createPortal(
    <div className={`tour-veil${spot ? " anchored" : ""}`} role="dialog" aria-modal="true"
         aria-label="Getting started">
      {/* The cutout. One element, a huge spread shadow, and the page shows through the
          hole — no second overlay to keep in step with the first. */}
      {spot && (
        <div
          className="tour-spot"
          aria-hidden="true"
          style={{
            top: spot.top - 6, left: spot.left - 6,
            width: spot.width + 12, height: spot.height + 12,
          }}
        />
      )}

      <div className={`tour${spot ? " tour-anchored" : ""}`} style={style}
           ref={card} tabIndex={-1}>
        <div className="tour-top">
          <p className="eyebrow">{step.eyebrow}</p>
          <button className="tour-skip" onClick={close}>{last ? "Close" : "Skip"}</button>
        </div>

        <h2 className="tour-title">{step.title}</h2>
        <div className="tour-body">
          {step.body}
          {seeking && <p className="note">Taking you there…</p>}
          {step.centredBecause && (
            /* Said out loud. A tour that points at three things and floats for two
               invites the question; answering it is cheaper than the doubt. */
            <p className="note tour-why">
              Not highlighted, because {step.centredBecause}.
            </p>
          )}
        </div>

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
