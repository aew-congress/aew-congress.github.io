import type { Metadata } from "next";
import "./globals.css";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://aew-congress.github.io";
const currentYear = new Intl.DateTimeFormat("en-PH", { year: "numeric", timeZone: "Asia/Manila" }).format(new Date());
const shareTitle = `AEW Congress ${currentYear}`;
const shareDescription = "AEW Congress recognizes, empowers, and supports agricultural and fishery extension workers and beyond.";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: shareTitle,
  description: shareDescription,
  openGraph: {
    type: "website",
    siteName: "AEW Congress",
    title: shareTitle,
    description: shareDescription,
    images: [{ url: "/og.png", width: 1732, height: 908, alt: shareDescription }],
  },
  twitter: {
    card: "summary_large_image",
    title: shareTitle,
    description: shareDescription,
    images: ["/og.png"],
  },
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
