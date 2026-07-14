import type { Metadata, Viewport } from "next";
import { Inter, Saira_Condensed, Hanken_Grotesk, IBM_Plex_Mono } from "next/font/google";
import { ConfirmHost, PromptHost, Toaster } from "./ui";
import { PwaRegister } from "./pwa-register";
import "./globals.css";

// Inter se conserva solo como fallback de cuerpo (--font-inter); el body real es Hanken.
const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter"
});

// TSC Security Design System — display / body / voz de datos operativa.
const saira = Saira_Condensed({
  subsets: ["latin"],
  display: "swap",
  weight: ["500", "600", "700", "800"],
  variable: "--font-saira"
});

const hanken = Hanken_Grotesk({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-hanken"
});

const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  display: "swap",
  weight: ["400", "500", "600"],
  variable: "--font-plex-mono"
});

export const metadata: Metadata = {
  applicationName: "TSC Capacita",
  title: "Capacitación TSC",
  description: "Plataforma de capacitación de TSC Seguridad Privada: cursos, evaluaciones y diplomas.",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Capacita"
  },
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/icons/favicon-32.png", type: "image/png", sizes: "32x32" },
      { url: "/icons/favicon-48.png", type: "image/png", sizes: "48x48" },
      { url: "/favicon.png", type: "image/png", sizes: "64x64" }
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }],
    shortcut: "/favicon.png"
  }
};

// Dark-first: el chrome del navegador/PWA usa el ink del design system (ink-700).
// El color-scheme por tema lo maneja globals.css (dark por defecto, light con
// data-theme), así que aquí solo fijamos el theme_color del chrome.
export const viewport: Viewport = {
  themeColor: "#121E23"
};

// Dark-first: el default (sin preferencia guardada) es OSCURO. Solo se aplica
// papel claro si el usuario guardó explícitamente 'light'.
const themeScript = `(function(){try{var t=localStorage.getItem('tsc_theme');if(t==='light'){document.documentElement.dataset.theme='light';}}catch(e){}})();`;

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="es"
      className={`${inter.variable} ${saira.variable} ${hanken.variable} ${plexMono.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        {children}
        <Toaster />
        <ConfirmHost />
        <PromptHost />
        <PwaRegister />
      </body>
    </html>
  );
}
