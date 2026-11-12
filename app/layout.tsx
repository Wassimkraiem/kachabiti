import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { Toaster } from 'react-hot-toast';
import { headers } from "next/headers";

// Fonts are self-hosted (Latin subsets from Google Fonts, see app/fonts) so dev and
// production builds never depend on downloading them from Google.
const inter = localFont({
  src: "./fonts/inter-latin-var.woff2",
  weight: "100 900",
  display: "swap",
});
const hando = localFont({
  src: "./fonts/handlee-latin.woff2",
  weight: "400",
  display: "swap",
  variable: "--font-hando",
});

// viewport-fit=cover lets the phone tab bar and buy bar sit above the iPhone home indicator.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#ffffff",
};

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || "https://www.kachabiti.com"),
  title: "Kachabiti - Handcrafted Traditional Products | Premium Quality",
  description: "Discover authentic handcrafted traditional products at Kachabiti. Premium quality HBarnous ROSSINI, Serviette de table, and unique handmade items. 100% authentic craftsmanship.",
  keywords: "handcrafted, traditional products, HBarnous ROSSINI, Serviette de table, artisan, handmade, premium quality, Tunisia, traditional wear, home accessories",
  authors: [{ name: "Kachabiti" }],
  creator: "Kachabiti",
  publisher: "Kachabiti",
  appleWebApp: {
    capable: true,
    title: "Kachabity",
    statusBarStyle: "default",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-video-preview": -1,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
  openGraph: {
    type: "website",
    locale: "en_US",
    siteName: "Kachabiti",
    title: "Kachabiti - Handcrafted Traditional Products",
    description: "Discover authentic handcrafted traditional products at Kachabiti. Premium quality HBarnous ROSSINI, Serviette de table, and unique handmade items.",
    images: [
      {
        url: "/assets/images/logoKachabity.jpg",
        width: 1200,
        height: 630,
        alt: "Kachabiti - Handcrafted Traditional Products",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Kachabiti - Handcrafted Traditional Products",
    description: "Discover authentic handcrafted traditional products at Kachabiti. Premium quality HBarnous ROSSINI, Serviette de table, and unique handmade items.",
    images: ["/assets/images/logoKachabity.jpg"],
  },
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Set by middleware.ts for localized routes; admin and API docs are English.
  const lang = (await headers()).get("x-locale") ?? "en";
  return (
    <html lang={lang} suppressHydrationWarning>
      <body className={`${inter.className} ${hando.variable}`} suppressHydrationWarning>
          {children}
          <Toaster
            position="top-center"
            toastOptions={{
              success: {
                style: {
                  // background: '#7a3b2e',
                  color: '#0000000',
                },
              },
              error: {
                style: {
                  // background: '#ef4444',
                  // color: '#fff',
                  color: '#0000000',
                },
              },
            }}
          />
      </body>
    </html>
  );
}
