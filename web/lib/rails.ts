/**
 * Whether a bid or claim can actually be submitted on the rail that is selected.
 *
 * Showing a reason is not enforcing it. The private rail's own button was correctly
 * disabled once a real STRK20 call had failed, and the disabled button explained why —
 * but the *submit* button never consulted the same fact, and the selected rail was not
 * reset. So a rail chosen before the failure stayed chosen after it, and "Bid privately"
 * remained live all the way back into the same wallet error.
 *
 * Same family as a queue offering calls the chain would reject: the interface knew, said
 * so, and still let the action through.
 */
export type Rail = "public" | "private";

export interface RailGate {
  rail: Rail;
  /** The private rail is offered at all: declared support, an anonymizer, no proven failure. */
  canPrivate: boolean;
  busy: boolean;
  connected: boolean;
}

/** The selected rail is one we have not proven broken. */
export const railUsable = (rail: Rail, canPrivate: boolean) =>
  rail === "public" || canPrivate;

/** Every reason a submit must not fire, in one place so the button cannot forget one. */
export const submitBlocked = ({ rail, canPrivate, busy, connected }: RailGate) =>
  busy || !connected || !railUsable(rail, canPrivate);
