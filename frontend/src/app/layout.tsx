import type { Metadata } from "next";
import { NavBar } from "@/components/NavBar";
import { DecisionLog } from "@/components/DecisionLog";
import { MobileGate } from "@/components/MobileGate";
import { PageTransition } from "@/components/PageTransition";

export const metadata: Metadata = {
  title: "AERO-GRID | Autonomous Drone Routing AI",
  description: "University AI Semester Project - Drone Mission Simulation",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark h-full">
      <body className="bg-[#06090f] text-white antialiased min-h-full flex flex-col font-mono relative">
        <div className="noise-overlay" />
        <NavBar />
        {/* Pages fade through PageTransition. DecisionLog + MobileGate sit
            OUTSIDE the wrapper so their own animations are independent of
            route changes (the log's drawer slide, the gate's CSS gate). */}
        <main className="flex-1 overflow-hidden relative">
          <PageTransition>
            {children}
          </PageTransition>
        </main>
        <DecisionLog />
        <MobileGate />
      </body>
    </html>
  );
}
