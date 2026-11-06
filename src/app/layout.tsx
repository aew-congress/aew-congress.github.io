import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AEW Congress | Programs & Learning Materials",
  description: "Programs, daily session flows, and learning materials for AEW Congress.",
  icons: {
    icon: "/AEW_logo.png",
    shortcut: "/AEW_logo.png",
    apple: "/AEW_logo.png",
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
