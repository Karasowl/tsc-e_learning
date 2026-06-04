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
    const body = (await response.json().catch(() => ({ error: response.statusText }))) as { error?: unknown };
    throw new Error(typeof body.error === "string" ? body.error : `HTTP ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export async function uploadAsset(token: string, file: File): Promise<{ id: string }> {
  const form = new FormData();
  form.append("file", file);
  const response = await fetch(`${API_URL}/assets`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
    body: form
  });
  if (!response.ok) {
    throw new Error("No se pudo subir el archivo");
  }
  const data = (await response.json()) as { asset: { id: string } };
  return data.asset;
}

export function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
