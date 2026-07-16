import type {
  RouteSummary,
  PlaybackManifest,
  PracticeRoute,
  Entitlements,
  ContributorProfile,
  InstructorStatus,
  UploadInitResult,
  UploadStatus,
} from './types';

export interface DeclaredFile {
  kind: 'front' | 'rear' | 'gpx';
  originalName: string;
  contentType: string;
  bytes: number;
}

/** PUT a File straight to a presigned storage URL (MinIO/R2), reporting progress. */
export function putToPresigned(
  url: string,
  file: File,
  onProgress?: (pct: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(new Error(`Upload failed (HTTP ${xhr.status})`));
    xhr.onerror = () => reject(new Error('Upload network error'));
    xhr.send(file);
  });
}
import {
  demo,
  demoRoutes,
  demoPlayback,
  demoPractice,
  demoEntitlements,
} from './demo';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const ACCESS = 'rs_access';
const REFRESH = 'rs_refresh';

export const tokens = {
  get access() {
    return localStorage.getItem(ACCESS);
  },
  get refresh() {
    return localStorage.getItem(REFRESH);
  },
  save(access: string, refresh: string) {
    localStorage.setItem(ACCESS, access);
    localStorage.setItem(REFRESH, refresh);
  },
  clear() {
    localStorage.removeItem(ACCESS);
    localStorage.removeItem(REFRESH);
  },
  get hasSession() {
    return !!localStorage.getItem(ACCESS);
  },
};

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

let refreshing: Promise<boolean> | null = null;

async function tryRefresh(): Promise<boolean> {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    const refresh = tokens.refresh;
    if (!refresh) return false;
    try {
      const res = await fetch('/api/auth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: refresh }),
      });
      if (!res.ok) throw new Error('refresh failed');
      const data = await res.json();
      tokens.save(data.accessToken, data.refreshToken);
      return true;
    } catch {
      tokens.clear();
      return false;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

async function request<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init.headers as Record<string, string>),
  };
  if (tokens.access) headers.Authorization = `Bearer ${tokens.access}`;

  let res: Response;
  try {
    res = await fetch(`/api${path}`, { ...init, headers });
  } catch {
    // network failure (backend not running / unreachable)
    throw new ApiError(0, 'Cannot reach the server');
  }

  if (res.status === 401 && retry && !path.startsWith('/auth/')) {
    const body401 = await res.clone().json().catch(() => ({}));
    // Phase 17: SESSION_INVALIDATED means another device logged in (ADI single-session).
    // Dispatch a custom event so AuthContext can show a meaningful message.
    if (body401.message === 'SESSION_INVALIDATED') {
      tokens.clear();
      window.dispatchEvent(new CustomEvent('session-invalidated'));
      throw new ApiError(401, 'SESSION_INVALIDATED');
    }
    if (await tryRefresh()) return request<T>(path, init, false);
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, body.title || body.detail || `HTTP ${res.status}`);
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

export const api = {
  // expose raw request for new feature pages
  request: <T>(path: string, init?: RequestInit) => request<T>(path, init),

  // auth
  login: (email: string, password: string) =>
    request<{ accessToken: string; refreshToken: string }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),
  register: (email: string, password: string, displayName: string) =>
    request<{ accessToken: string; refreshToken: string }>('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password, displayName }),
    }),

  // routes
  listRoutes: async () => {
    if (demo.on) return { items: demoRoutes, nextCursor: null };
    return request<{ items: RouteSummary[]; nextCursor: string | null }>('/routes');
  },
  searchRoutes: async (q: Record<string, string>) => {
    if (demo.on) {
      const term = (q.q ?? '').toLowerCase();
      return demoRoutes.filter(
        (r) =>
          (!q.difficulty || r.difficulty === q.difficulty) &&
          (!term ||
            r.title.toLowerCase().includes(term) ||
            (r.town ?? '').toLowerCase().includes(term) ||
            (r.postcode ?? '').toLowerCase().includes(term)),
      );
    }
    return request<RouteSummary[]>(`/search/routes?${new URLSearchParams(q).toString()}`);
  },
  playback: async (id: string) => {
    if (demo.on) {
      await sleep(300);
      return demoPlayback(id);
    }
    return request<PlaybackManifest>(`/routes/${id}/playback`);
  },
  practice: async (id: string) => {
    if (demo.on) {
      await sleep(200);
      return demoPractice(id);
    }
    return request<PracticeRoute>(`/routes/${id}/practice`);
  },

  // subscription
  me: async () => {
    if (demo.on) return demoEntitlements;
    return request<Entitlements>('/subscriptions/me');
  },
  plans: () => request<unknown[]>('/subscriptions/plans'),
  checkout: (plan: 'premium_monthly' | 'premium_yearly') =>
    request<{ url: string }>('/subscriptions/checkout', {
      method: 'POST',
      body: JSON.stringify({ plan }),
    }),

  // --- contributor tools ---
  profile: () => request<ContributorProfile>('/contributors/me/profile'),
  acceptAgreement: () => request<{ version: string }>('/contributors/agreement', { method: 'POST' }),
  instructorStatus: () => request<InstructorStatus>('/instructors/me/status'),
  submitInstructor: (adiNumber: string, evidenceUrl?: string) =>
    request<{ status: string }>('/instructors/verify', {
      method: 'POST',
      body: JSON.stringify({ adiNumber, evidenceUrl }),
    }),

  initUpload: (payload: {
    title: string;
    description?: string;
    testCentreId?: string;
    clockSource?: string;
    files: DeclaredFile[];
  }) => request<UploadInitResult>('/uploads', { method: 'POST', body: JSON.stringify(payload) }),
  completeUpload: (id: string) =>
    request<{ uploadId: string; status: string }>(`/uploads/${id}/complete`, { method: 'POST' }),
  uploadStatus: (id: string) => request<UploadStatus>(`/uploads/${id}`),
};
