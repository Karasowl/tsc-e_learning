"use client";

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export function assetFileUrl(assetId: string) {
  return `${API_URL}/assets/${assetId}/file`;
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
    if (response.status === 401 && typeof window !== "undefined") {
      window.localStorage.removeItem("tsc_token");
      window.localStorage.removeItem("tsc_user");
      window.location.reload();
    }
    const body = (await response.json().catch(() => ({ error: response.statusText }))) as { error?: unknown };
    throw new Error(typeof body.error === "string" ? body.error : `HTTP ${response.status}`);
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
  const response = await fetch(`${API_URL}/assets`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
    body: form
  });
  if (!response.ok) {
    throw new Error("No se pudo subir el archivo");
  }
  const data = (await response.json()) as { asset: UploadedAsset };
  return data.asset;
}

export async function downloadAsset(token: string, assetId: string, filename: string): Promise<void> {
  const response = await fetch(`${API_URL}/assets/${assetId}/file`, {
    headers: { authorization: `Bearer ${token}` }
  });
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
