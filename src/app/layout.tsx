import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "J.A.R.V.I.S. — Just A Rather Very Intelligent System",
  description:
    "Iron Man inspired AI command interface: voice control, FRIDAY tactical monitoring, E.D.I.T.H. vision, and a full holographic HUD.",
};

export const viewport: Viewport = {
  themeColor: "#020608",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        {/* React 19 hoists these into <head> */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Orbitron:wght@500;600;700;900&family=Rajdhani:wght@400;500;600;700&family=Share+Tech+Mono&display=swap"
          rel="stylesheet"
        />
        {children}
      </body>
    </html>
  );
}
