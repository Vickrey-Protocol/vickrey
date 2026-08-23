import Client from "./Client";
export const metadata = { title: "Auctioneer console — Vickrey" };
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <Client id={id} />;
}
