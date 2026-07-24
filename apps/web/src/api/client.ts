import type {
  RouteSummary,
  RouteDetail,
  RouteAccess,
  PlaybackManifest,
  PracticeRoute,
  Entitlements,
  ContributorProfile,
  InstructorStatus,
  UploadInitResult,
  UploadStatus,
  TestCentre,
  TestCentreDetail,
  TestCentreInput,
  TestDetails,
  TestDetailRecord,
  Me,
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

  // current user (includes role, for UI gating)
  meUser: async (): Promise<Me | null> => {
    if (demo.on) {
      return { id: 'demo', displayName: 'Demo user', role: 'user', email: null, avatarUrl: null };
    }
    return request<Me>('/users/me');
  },

  // routes
  listRoutes: async () => {
    if (demo.on) return { items: demoRoutes, nextCursor: null };
    return request<{ items: RouteSummary[]; nextCursor: string | null }>('/routes');
  },
  // Phase 20 global search: one term across title / instructor / centre / town / postcode.
  searchRoutes: async (q?: string): Promise<RouteSummary[]> => {
    if (demo.on) {
      const term = (q ?? '').toLowerCase();
      return demoRoutes.filter(
        (r) =>
          !term ||
          r.title.toLowerCase().includes(term) ||
          (r.town ?? '').toLowerCase().includes(term) ||
          (r.postcode ?? '').toLowerCase().includes(term) ||
          (r.instructorName ?? '').toLowerCase().includes(term),
      );
    }
    const qs = q && q.trim() ? `?q=${encodeURIComponent(q.trim())}` : '';
    return request<RouteSummary[]>(`/search/routes${qs}`);
  },

  // An instructor's published routes + the test centres they cover.
  instructorRoutes: (id: string) =>
    request<{ routes: RouteSummary[]; testCentres: TestCentre[] }>(`/routes/by-instructor/${id}`),

  // --- test centres (Phase 20) ---
  listTestCentres: (q?: string) => {
    const qs = q && q.trim() ? `?q=${encodeURIComponent(q.trim())}` : '';
    return request<TestCentre[]>(`/test-centres${qs}`);
  },
  testCentre: (id: string) => request<TestCentreDetail>(`/test-centres/${id}`),
  createTestCentre: (input: TestCentreInput) =>
    request<TestCentre>('/test-centres', { method: 'POST', body: JSON.stringify(input) }),
  updateTestCentre: (id: string, input: Partial<TestCentreInput>) =>
    request<TestCentre>(`/test-centres/${id}`, { method: 'PATCH', body: JSON.stringify(input) }),
  deleteTestCentre: (id: string) =>
    request<{ ok: boolean }>(`/test-centres/${id}`, { method: 'DELETE' }),
  route: async (id: string): Promise<RouteDetail> => {
    if (demo.on) {
      const r = demoRoutes.find((x) => x.id === id) ?? demoRoutes[0];
      return { ...r, testCentreId: null }; // demo grant is universal
    }
    const { route } = await request<{ route: RouteDetail }>(`/routes/${id}`);
    return route;
  },
  // Dry-run access decision (test details / paywall / ok) — no demo claim.
  routeAccess: (id: string): Promise<RouteAccess> => {
    if (demo.on) {
      return Promise.resolve({ allowed: true, reason: 'ok', testCentreId: null, centreLabel: '' });
    }
    return request<RouteAccess>(`/routes/${id}/access`);
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

  // Best-effort watch-time beacon (Phase 21). Feeds the instructor rev-share
  // engine (currently a 0% share — data + engagement only) and is a no-op in
  // demo mode. `keepalive` lets the final send survive a tab close / unmount.
  recordWatch: (id: string, secondsWatched: number, source: 'playback' | 'practice') => {
    if (demo.on || secondsWatched <= 0) return Promise.resolve();
    return request(`/routes/${id}/watch`, {
      method: 'POST',
      keepalive: true,
      body: JSON.stringify({ secondsWatched: Math.round(secondsWatched), source }),
    }).catch(() => {
      /* beacons are best-effort; never surface to the user */
    });
  },

  // subscription
  me: async () => {
    if (demo.on) return demoEntitlements;
    return request<Entitlements>('/subscriptions/me');
  },
  plans: () => request<unknown[]>('/subscriptions/plans'),
  // Premium is purchased per test centre; pass the centre being unlocked.
  checkout: (plan: 'premium_monthly' | 'premium_yearly', testCentreId?: string) =>
    request<{ url: string }>('/subscriptions/checkout', {
      method: 'POST',
      body: JSON.stringify({ plan, ...(testCentreId ? { testCentreId } : {}) }),
    }),

  // --- test details (Phase 19b) ---
  testCentres: (q?: string) => {
    if (demo.on) {
      // Surface the demo routes' towns as pickable centres.
      return Promise.resolve(
        demoRoutes.map((r) => ({
          id: `demo-tc-${r.id}`,
          name: `${r.town} test centre`,
          town: r.town,
          postcode: r.postcode,
        })) as TestCentre[],
      );
    }
    const qs = q ? `?q=${encodeURIComponent(q)}` : '';
    return request<TestCentre[]>(`/search/test-centres${qs}`);
  },
  getTestDetails: (): Promise<TestDetails> => {
    if (demo.on) {
      return Promise.resolve({
        current: {
          id: 'demo',
          testCentreId: 'demo-tc',
          testDate: new Date().toISOString().slice(0, 10),
          createdAt: new Date().toISOString(),
        },
        history: [],
      });
    }
    return request<TestDetails>('/users/me/test-details');
  },
  saveTestDetails: (testCentreId: string, testDate: string) => {
    if (demo.on) return Promise.resolve({} as TestDetailRecord);
    return request<TestDetailRecord>('/users/me/test-details', {
      method: 'POST',
      body: JSON.stringify({ testCentreId, testDate }),
    });
  },

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
