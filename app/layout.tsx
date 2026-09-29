import type { Metadata, Viewport } from "next";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import "./globals.css";

export const metadata: Metadata = {
  title: "LID | Torneo de vóley 2026",
  description: "Toda la información del Torneo Interno de Vóley LID 2026.",
  applicationName: "LID 2026",
  icons: {
    icon: [{ url: "/favicon.ico?v=20260929", type: "image/x-icon" }],
  },
};

export const viewport: Viewport = {
  themeColor: "#f7f6f2",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="es"><body>{children}<Analytics /><SpeedInsights /></body></html>;
}
