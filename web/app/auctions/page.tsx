import { readAll, toWire } from "@/lib/chain";
import { isDeployed } from "@/lib/config";
import AuctionsClient from "./AuctionsClient";

/** Public list. No wallet — a judge browses the book before deciding to connect. */
export const revalidate = 30;

export default async function Page() {
  if (!isDeployed()) return <AuctionsClient initial={[]} />;
  try {
    return <AuctionsClient initial={(await readAll()).map(toWire)} />;
  } catch {
    return <AuctionsClient initial={[]} />;
  }
}
