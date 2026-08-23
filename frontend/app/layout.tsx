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
          <div className="absolute inset-0 warp-grid opacity-60" />
          <div className="absolute inset-0 warp-ambient" />
        </div>

        {children}

        <Toaster
          theme="dark"
          position="bottom-right"
          toastOptions={{
            className: "!font-mono !text-xs",
            style: {
              background: "#101017",
              border: "1px solid #26263a",
              color: "#e9e6f2",
              borderRadius: "6px",
            },
          }}
        />
      </body>
    </html>
  );
}
