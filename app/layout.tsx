import type { Metadata, Viewport } from "next";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import "./globals.css";

export const metadata: Metadata = {
  title: "LID | Torneo de vóley 2026",
  description: "Toda la información del Torneo Interno de Vóley LID 2026.",
  applicationName: "LID 2026",
  metadataBase: new URL("https://lid-vit25.vercel.app"),
  openGraph: {
    type: "website",
    locale: "es_AR",
    url: "/",
    siteName: "LID",
    title: "LID | Torneo de vóley 2026",
    description: "Toda la información del Torneo Interno de Vóley LID 2026.",
  },
  twitter: {
    card: "summary",
    title: "LID | Torneo de vóley 2026",
    description: "Toda la información del Torneo Interno de Vóley LID 2026.",
  },
  icons: {
    icon: [{ url: "/favicon.ico?v=20260929", type: "image/x-icon" }],
  },
};

export const viewport: Viewport = {
  themeColor: "#f4f6f2",
  colorScheme: "light",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="es"><body>{children}<Analytics /><SpeedInsights /></body></html>;
}
