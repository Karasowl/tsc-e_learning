import type { Metadata } from "next";
import { Inter, Saira_Condensed, Hanken_Grotesk, IBM_Plex_Mono } from "next/font/google";
import { ConfirmHost, PromptHost, Toaster } from "./ui";
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
  title: "Capacitación TSC",
  description: "Plataforma de capacitación de TSC Seguridad Privada: cursos, evaluaciones y diplomas.",
  icons: {
    icon: "/favicon.png"
  }
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
      </body>
    </html>
  );
}
