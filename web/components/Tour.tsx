"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { TOUR_EVENT, markTourSeen, replayRequested, saveStep, savedStep, tourSeen } from "@/lib/tour";

/**
 * The first run, once — five stops, each one anchored to its item in the dashboard rail.
 *
 * The previous tour pointed at things on three different routes and navigated between
 * them. It lives inside the dashboard shell, and every dashboard route renders its own
 * shell — so each navigation mounted a fresh tour at step one, which navigated back,
 * and the first two cards played on a loop. Every stop here is in the rail, which is
 * on every dashboard page, so the tour never navigates and never remounts mid-flight.
 * The step is kept for the session anyway: a reload resumes rather than restarts.
 *
 * Below the rail's breakpoint the items are behind the menu button, so the cards are
 * centred and say so. A tour that points at a gap is the thing this replaces.
 */
interface Step {
  eyebrow: string;
  title: string;
  /** The rail item's `data-tour` value. */
  anchor: string;
  body: React.ReactNode;
}

const STEPS: Step[] = [
  {
    eyebrow: "Start here",
    title: "Create an auction",
    anchor: "nav-create",
    body: (
      <>
        <p>
          This is where you put something up for sale: the lot and the token it is paid
          in, the <b>ladder</b> of prices a bid can land on, the escrow every bidder posts,
          and the timing.
        </p>
        <p className="note">
          The ladder draws itself as you set the reserve, the top and the number of
          levels, so you see the auction bidders will see before you create it.
        </p>
      </>
    ),
  },
  {
    eyebrow: "What is yours",
    title: "My bids",
    anchor: "nav-bids",
    body: (
      <>
        <p>
          Every bid you place, and the <b>claim secret</b> that opens it. That secret is the
          only thing that can release a bid's escrow, and it exists in this browser and
          nowhere else — not on the chain, not with us.
        </p>
        <p className="note">
          Export a copy from that page and keep it where you would keep a key. Clearing
          site data ends it.
        </p>
      </>
    ),
  },
  {
    eyebrow: "The book",
    title: "Auctions",
    anchor: "nav-auctions",
    body: (
      <>
        <p>
          Every auction on this contract, in every state, with one column a wallet adds:
          your position in each. Open one to read its ladder and place a sealed bid.
        </p>
        <p className="note">
          Bid amounts are never on the chain, so nothing here shows you anyone's — only how
          many bids there are and what the clearing price turned out to be.
        </p>
      </>
    ),
  },
  {
    eyebrow: "What needs you",
    title: "Overview",
    anchor: "nav-overview",
    body: (
      <>
        <p>
          Steps in this protocol have deadlines, and missing one produces <b>no error</b>
          {" "}— it just quietly costs you something later. The overview leads with the queue
          of what needs you, each with a countdown and the absolute time.
        </p>
        <p className="note">
          The bell in the top bar carries the same queue on every page, and turns red when
          something closes within the hour.
        </p>
      </>
    ),
  },
  {
    eyebrow: "When in doubt",
    title: "The documentation",
    anchor: "nav-docs",
    body: (
      <>
        <p>
          Everything is written down: the six properties and why each is hard, how the
          hash chains prove a price without opening a bid, what the STRK20 integration
          reveals and what it does not.
        </p>
        <p className="note">
          For any doubt or question, check the docs first — they are written so you can
          verify the claims rather than take them. You can replay this tour from the wallet
          menu at any time.
        </p>
      </>
    ),
  },
];

/** Where the card sits relative to the anchor. */
interface Spot { top: number; left: number; width: number; height: number }

/** The rail is behind the menu button below this width, so there is nothing to point at. */
const railHidden = () => window.matchMedia("(max-width: 63.99rem)").matches;

export function Tour() {
  const [open, setOpen] = useState(false);
  const [i, setI] = useState(0);
  const [spot, setSpot] = useState<Spot | null>(null);
  const card = useRef<HTMLDivElement>(null);

  const step = STEPS[i]!;
  const last = i === STEPS.length - 1;

  /* First visit, a reload mid-tour, or a replay asked for from another page. */
  useEffect(() => {
    if (replayRequested()) { setI(0); setOpen(true); return; }
    if (!tourSeen()) { setI(savedStep()); setOpen(true); }
  }, []);
  useEffect(() => {
    const replay = () => { replayRequested(); setI(0); setOpen(true); };
    window.addEventListener(TOUR_EVENT, replay);
    return () => window.removeEventListener(TOUR_EVENT, replay);
  }, []);
  useEffect(() => { if (open) saveStep(i); }, [open, i]);

  const close = useCallback(() => { markTourSeen(); setOpen(false); setSpot(null); }, []);

  /* Find the rail item and keep the highlight on it while the page moves under it. */
  useEffect(() => {
    if (!open) return;
    if (railHidden()) { setSpot(null); return; }
    let raf = 0;
    const measure = () => {
      const el = document.querySelector<HTMLElement>(`[data-tour="${step.anchor}"]`);
      if (!el) { setSpot(null); return; }
      const r = el.getBoundingClientRect();
      setSpot({ top: r.top, left: r.left, width: r.width, height: r.height });
    };
    measure();
    const onMove = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(measure); };
    window.addEventListener("scroll", onMove, true);
    window.addEventListener("resize", onMove);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", onMove, true);
      window.removeEventListener("resize", onMove);
    };
  }, [open, i, step.anchor]);

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

  /* Beside the rail item, to its right, level with it; clamped to the viewport. */
  const CARD_W = 380;
  const GAP = 18;
  let style: React.CSSProperties = {};
  if (spot) {
    const top = Math.min(Math.max(12, spot.top - 12), Math.max(12, window.innerHeight - 320));
    style = {
      position: "fixed",
      top,
      left: Math.min(spot.left + spot.width + GAP, Math.max(12, window.innerWidth - CARD_W - 12)),
      width: CARD_W,
    };
  }

  return createPortal(
    <div className={`tour-veil${spot ? " anchored" : ""}`} role="dialog" aria-modal="true"
         aria-label="Getting started">
      {/* The cutout: one element with a huge spread shadow, and the rail item shows
          through the hole. */}
      {spot && (
        <div
          className="tour-spot"
          aria-hidden="true"
          style={{ top: spot.top - 6, left: spot.left - 6, width: spot.width + 12, height: spot.height + 12 }}
        />
      )}

      <div className={`tour${spot ? " tour-anchored" : ""}`} style={style} ref={card} tabIndex={-1}>
        <div className="tour-top">
          <p className="eyebrow">{step.eyebrow}</p>
          <button className="tour-skip" onClick={close}>{last ? "Close" : "Skip"}</button>
        </div>

        <h2 className="tour-title">{step.title}</h2>
        <div className="tour-body">
          {step.body}
          {!spot && (
            <p className="note tour-why">
              On this screen the item is behind the menu button at the top — open it to find
              {" "}<b>{step.title}</b>.
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
