import type { Metadata } from "next";
import { Bricolage_Grotesque, Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { Nav } from "@/components/nav";
import { Footer } from "@/components/footer";

// Type system — deliberately NOT the Next.js default Geist pairing:
//   Bricolage Grotesque → display/headings (editorial character)
//   Inter               → body/UI (neutral, legible foil)
//   JetBrains Mono       → data/numerals (the Elo, bits & points everywhere)
const display = Bricolage_Grotesque({ variable: "--font-display-var", subsets: ["latin"], display: "swap" });
const sans = Inter({ variable: "--font-sans-var", subsets: ["latin"], display: "swap" });
const mono = JetBrains_Mono({ variable: "--font-mono-var", subsets: ["latin"], display: "swap" });

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
    <html
      lang="en"
      className={`${display.variable} ${sans.variable} ${mono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {/* Set the theme before paint (no flash). Defaults to dark. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "(function(){try{var t=localStorage.getItem('sb_theme')||'dark';document.documentElement.setAttribute('data-theme',t);}catch(e){}})();",
          }}
        />
        <Nav />
        <main className="flex-1">{children}</main>
        <Footer />
      </body>
    </html>
  );
}
