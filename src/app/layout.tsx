import type { Metadata, Viewport } from "next";
import { Inter, Space_Grotesk } from "next/font/google";
import "./globals.css";
import Providers from "./providers";

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-inter",
  display: "swap",
});

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-space-grotesk",
  display: "swap",
});

export const metadata: Metadata = {
  title: "DishData — AI Restaurant Intelligence",
  description:
    "DishData: AI-powered restaurant management. Lower food costs, streamline operations, grow profit.",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [{ url: "/favicon.svg", type: "image/svg+xml" }, { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }],
    // iPhones ignore SVG and the manifest icons for the home screen; this PNG is what "Add to Home Screen" uses.
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  // Lets the site launch like an app from an iPhone's home screen: no Safari bars, its own name. "black"
  // keeps the page below the status bar, so nothing slides under the notch.
  appleWebApp: { capable: true, title: "DishData", statusBarStyle: "black" },
  formatDetection: { telephone: false },
  // Next only writes the generic mobile-web-app-capable tag; iPhones before iOS 16.4 look for Apple's own.
  other: { "apple-mobile-web-app-capable": "yes" },
};

export const viewport: Viewport = {
  themeColor: "#08080d",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`dark ${inter.variable} ${spaceGrotesk.variable}`}>
      <body suppressHydrationWarning>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
