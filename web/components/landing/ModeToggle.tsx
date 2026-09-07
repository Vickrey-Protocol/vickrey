"use client";

/**
 * The template's mode toggle. It writes the attribute the stylesheet keys on and
 * remembers the choice; which icon shows is decided by that attribute in CSS, so the
 * right one is there before hydration and no state is needed to render it.
 */
export function ModeToggle({ className = "" }: { className?: string }) {
  const toggle = () => {
    const root = document.documentElement;
    const next = root.dataset.theme === "dark" ? "light" : "dark";
    root.dataset.theme = next;
    try { localStorage.setItem("theme", next); } catch { /* private mode: the choice lasts the page */ }
  };
  return (
    <button
      type="button" onClick={toggle} aria-label="Toggle theme"
      className={"tw:flex tw:h-10 tw:w-10 tw:items-center tw:justify-center tw:overflow-hidden tw:rounded-lg tw:border-0 tw:bg-transparent tw:p-0 tw:shadow-none tw:hover:bg-gray-50 tw:dark:hover:bg-white/10 tw:max-lg:h-11 tw:max-lg:w-11 " + className}
    >
      <svg className="lp-sun tw:h-4 tw:w-4 tw:flex-shrink-0 tw:text-neutral-700 tw:dark:text-neutral-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
      </svg>
      <svg className="lp-moon tw:h-4 tw:w-4 tw:flex-shrink-0 tw:text-neutral-700 tw:dark:text-neutral-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
      </svg>
    </button>
  );
}
