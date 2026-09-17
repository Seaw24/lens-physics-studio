import type { PublicUser } from "../../shared/auth";

type AuthResponse = { user: PublicUser };

async function request<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(`/api/auth${path}`, {
    ...init,
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(data?.error?.message || "Authentication failed.");
  }
  return data as T;
}

export const authApi = {
  me: () => request<AuthResponse>("/me"),
  login: (email: string, password: string) =>
    request<AuthResponse>("/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),
  register: (email: string, password: string, displayName?: string) =>
    request<AuthResponse>("/register", {
      method: "POST",
      body: JSON.stringify({ email, password, displayName }),
    }),
  logout: async () => {
    const response = await fetch("/api/auth/logout", {
      method: "DELETE",
      credentials: "same-origin",
    });
    if (!response.ok && response.status !== 204) {
      const data = await response.json().catch(() => null);
      throw new Error(data?.error?.message || "Could not sign out.");
    }
  },
};
