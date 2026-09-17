const ACTIVE_USER_KEY = "momentum-active-user-id";

const APP_STORAGE_KEYS = [
  "lens-notebook-v1",
  "lens-course-sources-v1",
  "lens-course-diagnostic-v1",
  "momentum-day-selected",
  "momentum-discovery-active",
] as const;

export function readActiveUserId(): string | null {
  try {
    return localStorage.getItem(ACTIVE_USER_KEY);
  } catch {
    return null;
  }
}

export function setActiveUserId(userId: string) {
  try {
    localStorage.setItem(ACTIVE_USER_KEY, userId);
  } catch {
    // Session still works when storage is unavailable.
  }
}

export function clearLocalUserData() {
  try {
    for (const key of APP_STORAGE_KEYS) localStorage.removeItem(key);
    for (let i = localStorage.length - 1; i >= 0; i -= 1) {
      const key = localStorage.key(i);
      if (key?.startsWith("studio:")) localStorage.removeItem(key);
    }
  } catch {
    // Continue with in-memory reset even when storage is blocked.
  }
}

export function shouldResetLocalData(userId: string, isSignup: boolean) {
  if (isSignup) return true;
  const previous = readActiveUserId();
  return Boolean(previous && previous !== userId);
}
