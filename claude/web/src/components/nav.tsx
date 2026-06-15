"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

const LINKS = [
  { href: "/leaderboard", label: "Leaderboard" },
  { href: "/games", label: "Games" },
  { href: "/atlas", label: "Atlas" },
  { href: "/play", label: "Play" },
  { href: "/live", label: "Live" },
  { href: "/native", label: "Native" },
  { href: "/agents", label: "For Agents" },
  { href: "/methodology", label: "Method" },
];

export function Nav() {
  const path = usePathname();
  return (
    <header className="sticky top-0 z-50 border-b border-border-soft bg-bg/80 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-7xl items-center gap-1 px-4 sm:px-6">
        <Link href="/" className="font-display mr-4 flex items-center gap-2 text-[1.05rem] font-extrabold tracking-tight">
          <Logo />
          <span className="text-fg">
            Steam<span className="text-brand">Bench</span>
          </span>
        </Link>
        <nav className="hidden items-center gap-1 md:flex">
          {LINKS.map((l) => {
            const active = path === l.href || (l.href !== "/" && path.startsWith(l.href));
            return (
              <Link
                key={l.href}
                href={l.href}
                className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                  active ? "text-brand" : "text-muted hover:text-fg"
                }`}
              >
                {l.label}
              </Link>
            );
          })}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <ThemeToggle />
          <Link href="/me" className="btn btn-primary !py-1.5 !px-3 text-sm">
            <SteamGlyph /> Connect Steam
          </Link>
        </div>
      </div>
    </header>
  );
}

function ThemeToggle() {
  const [theme, setTheme] = useState<string | null>(null);
  useEffect(() => {
    setTheme(document.documentElement.getAttribute("data-theme") || "light");
  }, []);
  function toggle() {
    const next = theme === "light" ? "dark" : "light";
    setTheme(next);
    document.documentElement.setAttribute("data-theme", next);
    try {
      localStorage.setItem("sb_theme", next);
    } catch {
      /* ignore */
    }
  }
  return (
    <button
      onClick={toggle}
      aria-label="Toggle light / dark theme"
      title="Toggle theme"
      className="flex h-8 w-8 items-center justify-center rounded-md border border-border-soft text-muted transition hover:border-brand hover:text-brand"
    >
      {/* placeholder until mounted to avoid hydration mismatch */}
      {theme === null ? <span className="h-4 w-4" /> : theme === "light" ? <MoonIcon /> : <SunIcon />}
    </button>
  );
}

function SunIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
    </svg>
  );
}

function Logo() {
  return (
    <span className="relative inline-flex h-6 w-6 items-center justify-center">
      <span className="absolute inset-0 rounded-md bg-gradient-to-br from-brand to-accent opacity-90" />
      <span className="relative text-[13px] font-black text-[#04121f]">S</span>
    </span>
  );
}

function SteamGlyph() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12 2a10 10 0 0 0-9.9 8.7l5.4 2.2a2.8 2.8 0 0 1 1.6-.5l2.4-3.5v-.05a3.75 3.75 0 1 1 3.75 3.75h-.08l-3.45 2.46a2.8 2.8 0 0 1-5.55.5L2.3 14a10 10 0 1 0 9.7-12zm-4.2 15.2a2.15 2.15 0 0 1-1.2-2.8l1 .4a1.58 1.58 0 1 0 1.2-2.9l-1-.4a2.15 2.15 0 0 1 2.9 2 2.15 2.15 0 0 1-2.9 3.7zm8.7-7.2a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5z" />
    </svg>
  );
}
