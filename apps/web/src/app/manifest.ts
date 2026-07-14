import type { MetadataRoute } from "next";

/**
 * Web App Manifest (PWA) del LMS TSC Capacita.
 * Next App Router lo sirve en /manifest.webmanifest e inyecta el <link rel="manifest">.
 *
 * Dark-first: el chrome instalado usa el ink del design system (theme ink-700,
 * fondo ink-900). La experiencia instalable objetivo es la cáscara móvil del
 * guardia (retrato), que es la que se empaqueta a la tienda.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "TSC Capacita",
    short_name: "Capacita",
    description:
      "Capacitación del personal de seguridad de TSC: cursos, evaluaciones, rango y diplomas.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    lang: "es",
    dir: "ltr",
    categories: ["education", "productivity"],
    theme_color: "#121E23",
    background_color: "#090F12",
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any"
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any"
      },
      {
        src: "/icons/maskable-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "maskable"
      },
      {
        src: "/icons/maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable"
      }
    ]
  };
}
