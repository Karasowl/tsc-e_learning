import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { ConfirmHost, PromptHost, Toaster } from "./ui";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter"
});

export const metadata: Metadata = {
  title: "Capacitación TSC",
  description: "Plataforma de capacitación de TSC Seguridad Privada: cursos, evaluaciones y diplomas.",
  icons: {
    icon: "/favicon.png"
  }
};

const themeScript = `(function(){try{var t=localStorage.getItem('tsc_theme');if(t==='dark'||(!t&&window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches)){document.documentElement.dataset.theme='dark';}}catch(e){}})();`;

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es" className={inter.variable} suppressHydrationWarning>
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
