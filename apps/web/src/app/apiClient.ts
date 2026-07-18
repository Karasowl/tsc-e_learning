"use client";

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export function assetFileUrl(assetId: string) {
  return `${API_URL}/assets/${assetId}/file`;
}

// Sesión vencida o inválida: se limpia y se recarga para volver al login.
// Centralizado para que TODOS los fetch autenticados compartan el mismo trato.
function clearSessionAndReload() {
  if (typeof window !== "undefined") {
    window.localStorage.removeItem("tsc_token");
    window.localStorage.removeItem("tsc_user");
    window.location.reload();
  }
}

// Convierte el cuerpo de error del servidor en un mensaje legible en español.
// Los errores de validación llegan como objeto (formErrors/fieldErrors); se toma
// el primer mensaje disponible y, si no hay ninguno, un texto genérico por código.
export function apiErrorMessage(body: unknown, status: number): string {
  const error = body && typeof body === "object" && "error" in body ? (body as { error?: unknown }).error : body;
  if (typeof error === "string" && error.trim()) {
    return error;
  }
  if (error && typeof error === "object") {
    const shaped = error as { formErrors?: unknown; fieldErrors?: unknown; message?: unknown };
    if (typeof shaped.message === "string" && shaped.message.trim()) {
      return shaped.message;
    }
    const issues: string[] = [];
    if (Array.isArray(shaped.formErrors)) {
      issues.push(...shaped.formErrors.filter((item): item is string => typeof item === "string"));
    }
    if (shaped.fieldErrors && typeof shaped.fieldErrors === "object") {
      for (const value of Object.values(shaped.fieldErrors as Record<string, unknown>)) {
        if (Array.isArray(value)) {
          issues.push(...value.filter((item): item is string => typeof item === "string"));
        }
      }
    }
    const first = issues.find((item) => item.trim().length > 0);
    if (first) {
      return first;
    }
  }
  if (status === 400 || status === 422) {
    return "Revisa los datos ingresados";
  }
  if (status === 403) {
    return "No tienes permiso para realizar esta acción";
  }
  if (status === 404) {
    return "No se encontró el recurso solicitado";
  }
  if (status >= 500) {
    return "El servidor tuvo un problema. Intenta de nuevo";
  }
  return `No se pudo completar la operación (código ${status})`;
}

// Fetch autenticado "crudo" (para descargas, HTML, streams): aplica el mismo
// tratamiento de sesión vencida (401 → limpiar y recargar) y devuelve la Response.
export async function authFetchRaw(token: string, path: string, init: RequestInit = {}): Promise<Response> {
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      ...(init.headers ?? {})
    }
  });
  if (response.status === 401) {
    clearSessionAndReload();
  }
  return response;
}

export async function authFetch<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      ...(init.body ? { "content-type": "application/json" } : {}),
      authorization: `Bearer ${token}`,
      ...(init.headers ?? {})
    }
  });
  if (!response.ok) {
    if (response.status === 401) {
      clearSessionAndReload();
    }
    const body = (await response.json().catch(() => ({ error: response.statusText }))) as unknown;
    throw new Error(apiErrorMessage(body, response.status));
  }
  // Respuestas sin cuerpo (p. ej. DELETE → 204) no se intentan parsear.
  if (response.status === 204) {
    return undefined as T;
  }
  return response.json() as Promise<T>;
}

export type UploadedAsset = {
  id: string;
  title: string;
  mimeType: string | null;
  sizeBytes: number | null;
};

export async function uploadAsset(
  token: string,
  file: File,
  opts: { lessonId?: string } = {}
): Promise<UploadedAsset> {
  const form = new FormData();
  // The lessonId must be appended BEFORE the file so the server sees it while
  // streaming the multipart body.
  if (opts.lessonId) {
    form.append("lessonId", opts.lessonId);
  }
  form.append("file", file);
  const response = await authFetchRaw(token, "/assets", {
    method: "POST",
    body: form
  });
  if (!response.ok) {
    throw new Error("No se pudo subir el archivo");
  }
  const data = (await response.json()) as { asset: UploadedAsset };
  return data.asset;
}

export async function downloadAsset(token: string, assetId: string, filename: string): Promise<void> {
  const response = await authFetchRaw(token, `/assets/${assetId}/file`);
  if (!response.ok) {
    throw new Error("No se pudo descargar el archivo");
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename || "archivo";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
