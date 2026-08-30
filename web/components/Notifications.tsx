"use client";

import { useCallback, useRef, useState } from "react";
import Link from "next/link";
import { countdown, utcDate } from "@/lib/config";
import { isUrgent, type DueAction } from "@/lib/actions";
import { useNow } from "@/components/WalletProvider";
import { Popover } from "@/components/Popover";

/**
 * The obligations panel.
 *
 * This is the product's central UX problem rather than a convenience. Every other
 * failure in this app announces itself — a transaction reverts, a form refuses. The
 * time-gated steps do not: a seed nobody sends, a dispute window nobody opens and a
 * refund nobody claims all look exactly like doing nothing, right up until the money has
 * moved without you.
 *
 * Three things follow from that, and they are why this is not a dropdown of links.
 *
 * **The consequence is the content.** A list of verbs assumes the reader already knows
 * what happens if they don't. Nobody does — this protocol is new — so every entry states
 * what missing it costs, in its own line, in the same place every time.
 *
 * **Urgency is structural, not typographic.** Sorting by deadline and colouring the top
 * one red asks the reader to infer the boundary. Grouping under "Closing soon" states
 * it. The groups are what make a glance sufficient.
 *
 * **Both clocks, always.** R4: a countdown conveys urgency but cannot be quoted in a
 * dispute; an absolute UTC timestamp can be quoted but does not convey anything at a
 * glance. Showing one and hiding the other behind a tooltip fails on touch, so both are
 * always on screen.
 */

const Bell = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"
       stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
    <path d="M13.7 21a2 2 0 0 1-3.4 0" />
  </svg>
);

/** Distinct enough to scan, quiet enough not to shout. */
const ROLE: Record<DueAction["role"], string> = {
  bidder: "As bidder",
  auctioneer: "As auctioneer",
};

function Deadline({ a, now }: { a: DueAction; now: number }) {
  if (a.deadline === null) {
    return <span className="note">No deadline — it waits for you</span>;
  }
  const left = countdown(a.deadline, now);
  const urgent = isUrgent(a, now);
  return (
    <>
      <span className={urgent ? "countdown urgent" : "countdown"}>
        {left ?? "window closed"}
      </span>
      <span className="note">
        {/* A bound is not a cutoff. Saying "closes in 58m" about the seed window would
            promise something no rule keeps — the auctioneer may settle at any moment. */}
        {a.deadlineKind === "bound" ? "at the latest · " : ""}
        {utcDate(a.deadline)}
      </span>
    </>
  );
}

function Item({ a, now, onGo }: { a: DueAction; now: number; onGo: () => void }) {
  return (
    <Link href={a.href} className="note-item" onClick={onGo}>
      <div className="note-head">
        <span className="note-role">{ROLE[a.role]}</span>
        <span className="note-auction">Auction #{a.auctionId.toString()}</span>
      </div>
      <p className="note-title">{a.title}</p>
      <p className="note-detail">{a.detail}</p>
      <p className="note-cost">
        <span className="note-cost-lab">If you miss it</span>
        {a.consequence}
      </p>
      <div className="note-when"><Deadline a={a} now={now} /></div>
      <span className="note-cta">{a.cta} →</span>
    </Link>
  );
}

export function Notifications({ actions }: { actions: DueAction[] }) {
  /* Its own clock rather than the shell's. Countdowns need a tick a second, and hoisting
     that into `DashShell` would re-render every dashboard page on every tick to animate
     one badge. */
  const now = useNow();
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);

  const count = actions.length;
  const urgent = actions.filter((a) => isUrgent(a, now)).length;

  const close = useCallback(() => {
    setOpen(false);
    btn.current?.focus();
  }, []);

  /* Grouped rather than merely sorted: the boundary between "act now" and "act sometime"
     is the thing the reader needs, and a gradient of red does not state it. */
  const soon = actions.filter((a) => isUrgent(a, now));
  const dated = actions.filter((a) => !isUrgent(a, now) && a.deadline !== null);
  const undated = actions.filter((a) => a.deadline === null);

  const label = count === 0
    ? "Nothing needs you"
    : `${count} action${count === 1 ? "" : "s"} need${count === 1 ? "s" : ""} you`
      + (urgent ? `, ${urgent} closing within the hour` : "");

  return (
    <div className="bell-wrap">
      <button
        ref={btn}
        className={`bell${open ? " on" : ""}`}
        onClick={() => (open ? close() : setOpen(true))}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={label}
      >
        <Bell />
        {count > 0 && (
          <span className={`bell-count${urgent ? " urgent" : ""}`} aria-hidden="true">
            {count}
          </span>
        )}
      </button>

      {/* Announced separately from the button, so a change in the count is spoken without
          the reader having to go looking for the control. */}
      <span className="sr-only" role="status" aria-live="polite">{label}</span>

      <Popover open={open} anchor={btn} onClose={close} label="Actions that need you">
        <header className="sheet-top">
          <div>
            <p className="eyebrow">Needs you</p>
            <p className="sheet-count">
              {count === 0 ? "Nothing right now" : `${count} open`}
            </p>
          </div>
          <button className="sheet-x" onClick={close} aria-label="Close">×</button>
        </header>

        <div className="sheet-body">
          {count === 0 ? (
            <div className="sheet-empty">
              <p><b>Nothing needs you right now.</b></p>
              <p className="note">
                Steps appear here the moment they can actually be taken — never before,
                so nothing listed can refuse. Seeds to send, windows to check, money to
                collect.
              </p>
            </div>
          ) : (
            <>
              {soon.length > 0 && (
                <section className="sheet-group urgent">
                  <h3>Closing within the hour</h3>
                  {soon.map((a) => (
                    <Item key={`${a.kind}-${a.auctionId}`} a={a} now={now} onGo={close} />
                  ))}
                </section>
              )}
              {dated.length > 0 && (
                <section className="sheet-group">
                  <h3>On a clock</h3>
                  {dated.map((a) => (
                    <Item key={`${a.kind}-${a.auctionId}`} a={a} now={now} onGo={close} />
                  ))}
                </section>
              )}
              {undated.length > 0 && (
                <section className="sheet-group">
                  <h3>When you are ready</h3>
                  {undated.map((a) => (
                    <Item key={`${a.kind}-${a.auctionId}`} a={a} now={now} onGo={close} />
                  ))}
                </section>
              )}
            </>
          )}
        </div>
      </Popover>
    </div>
  );
}
