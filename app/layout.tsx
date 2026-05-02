import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "Buoyant Proposal Editor",
  description:
    "Fidelity-first AI editor for civil-engineering proposals. Track Changes for PDFs.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-background text-foreground antialiased">
        {children}
      </body>
    </html>
  );
}
