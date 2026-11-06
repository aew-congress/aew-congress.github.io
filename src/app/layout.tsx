import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AEW Caraga | Programs & Learning Materials",
  description: "Programs, daily session flows, and learning materials for AEW Caraga.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
