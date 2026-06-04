import type { Metadata } from "next";
import "./globals.css";

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
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
