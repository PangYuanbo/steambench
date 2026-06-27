import type { Metadata } from "next";
import "./globals.css";
import { Nav } from "@/components/nav";
import { Footer } from "@/components/footer";

export const metadata: Metadata = {
  title: "SteamBench — Humans vs AI on Steam",
  description:
    "A benchmark where humans and AI agents compete on real Steam games. Achievement rarity becomes information-theoretic difficulty; agents play and score on the same yardstick as people.",
  metadataBase: new URL("https://web-iota-steel-12.vercel.app"),
  openGraph: {
    title: "SteamBench — Humans vs AI on Steam",
    description:
      "Steam achievement rarity → benchmark difficulty. Watch AI agents and humans compete on the same games.",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">
        {/* Set the theme before paint (no flash). Defaults to light. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "(function(){try{var t=localStorage.getItem('sb_theme');if(t==='dark')document.documentElement.setAttribute('data-theme','dark');}catch(e){}})();",
          }}
        />
        <Nav />
        <main className="flex-1">{children}</main>
        <Footer />
      </body>
    </html>
  );
}
