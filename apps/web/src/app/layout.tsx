import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { ConfirmHost, Toaster } from "./ui";
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

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es" className={inter.variable}>
      <body>
        {children}
        <Toaster />
        <ConfirmHost />
      </body>
    </html>
  );
}
