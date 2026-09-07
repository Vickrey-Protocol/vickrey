import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

/**
 * The template's three button shapes, as one component. A `href` renders a link with
 * the same face; anything else is a real <button>, so the element matches the action.
 *
 * 44px tall below `lg` — the touch bands the audit measures — and the template's
 * tighter 36px above it, where a pointer is precise.
 */
const FACE = {
  primary:
    "tw:bg-neutral-900 tw:text-white tw:border-transparent tw:hover:bg-black/90 " +
    "tw:shadow-[0px_-1px_0px_0px_#FFFFFF40_inset,_0px_1px_0px_0px_#FFFFFF40_inset]",
  simple: "tw:bg-transparent tw:text-black tw:border-transparent tw:hover:bg-neutral-100",
  outline: "tw:bg-white tw:text-black tw:border-black tw:hover:bg-black/90 tw:hover:text-white tw:hover:shadow-xl",
} as const;

const BASE =
  "tw:relative tw:z-10 tw:inline-flex tw:items-center tw:justify-center tw:gap-2 tw:rounded-full " +
  "tw:border tw:px-4 tw:py-2 tw:text-sm tw:font-medium tw:tracking-normal tw:no-underline " +
  "tw:transition tw:duration-200 tw:cursor-pointer tw:max-lg:min-h-11 tw:disabled:opacity-50 tw:disabled:cursor-not-allowed";

type Common = { variant?: keyof typeof FACE; className?: string; children: ReactNode };
type AsLink = Common & { href: string } & Omit<ComponentProps<typeof Link>, "href" | "className" | "children">;
type AsButton = Common & { href?: undefined } & Omit<ComponentProps<"button">, "className" | "children">;

export function LpButton(props: AsLink | AsButton) {
  const { variant = "primary", className = "", children, ...rest } = props;
  const cls = `${BASE} ${FACE[variant]} ${className}`.trim();
  if ("href" in rest && typeof rest.href === "string") {
    return <Link {...(rest as AsLink)} className={cls}>{children}</Link>;
  }
  return <button type="button" {...(rest as ComponentProps<"button">)} className={cls}>{children}</button>;
}
