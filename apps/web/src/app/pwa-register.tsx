"use client";

import { useEffect } from "react";

/**
 * Registro del service worker de la PWA.
 * Solo en producción: en dev (y por tanto en los e2e que corren `pnpm dev`) no
 * se registra, así el service worker nunca interfiere con el hot-reload ni con
 * la navegación de las pruebas.
 */
export function PwaRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") {
      return;
    }
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
      return;
    }
    const register = () => {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        /* la app funciona sin SW; el registro es best-effort */
      });
    };
    if (document.readyState === "complete") {
      register();
    } else {
      window.addEventListener("load", register, { once: true });
      return () => window.removeEventListener("load", register);
    }
    return undefined;
  }, []);

  return null;
}
