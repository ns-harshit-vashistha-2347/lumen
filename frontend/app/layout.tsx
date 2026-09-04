import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { Toaster } from "sonner";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

const mono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Lumen — chat with your documents",
  description: "A terminal-style RAG workspace. Upload documents, choose scope, ask.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${mono.variable}`}>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var t=localStorage.getItem('lumen.theme');if(t&&t!=='monokai')document.documentElement.setAttribute('data-theme',t);}catch(e){}`,
          }}
        />
      </head>
      <body className="min-h-screen bg-bg text-ink antialiased">
        <div className="pointer-events-none fixed inset-0 -z-10">
          <div className="absolute inset-0 hacker-grid opacity-60" />
          <div className="absolute inset-0 warp-ambient" />
          <div className="absolute inset-0 bg-scanline opacity-30 mix-blend-overlay" />
          <div className="absolute inset-0 crt-vignette" />
        </div>

        {children}

        <Toaster
          position="bottom-right"
          toastOptions={{
            className: "!font-mono !text-xs !bg-bg-soft !text-ink !border !border-chrome-border !rounded-md",
          }}
        />
      </body>
    </html>
  );
}
