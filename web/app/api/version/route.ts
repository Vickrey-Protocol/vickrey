/**
 * What commit is actually live.
 *
 * Four commits once sat on `main` while the deployed site served an older build, and
 * nothing anywhere said so — the repo looked right, the site looked plausible, and the
 * two had quietly diverged. This endpoint is what makes that visible: compare it to
 * `git rev-parse HEAD` and a stale deploy stops being something you find by accident.
 *
 * `VERCEL_GIT_COMMIT_SHA` is set only for git-triggered deploys. A CLI deploy has to be
 * told, which `scripts/deploy-web.sh` does with `--build-env`. If neither is present the
 * answer is "unknown", which is honest and still fails the check — a deploy that cannot
 * say what it is does not get to pass.
 */
export const dynamic = "force-dynamic";

export function GET() {
  return Response.json(
    {
      commit:
        process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.NEXT_PUBLIC_COMMIT ?? "unknown",
      ref: process.env.VERCEL_GIT_COMMIT_REF ?? null,
      builtAt: process.env.NEXT_PUBLIC_BUILT_AT ?? null,
      network: process.env.NEXT_PUBLIC_NETWORK ?? null,
      auction: process.env.NEXT_PUBLIC_AUCTION_ADDRESS ?? null,
      anonymizer: process.env.NEXT_PUBLIC_ANONYMIZER_ADDRESS ?? null,
    },
    { headers: { "cache-control": "no-store" } },
  );
}
