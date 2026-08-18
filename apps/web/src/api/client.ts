import type {
  RouteSummary,
  RouteDetail,
  RouteAccess,
  PlaybackManifest,
  PracticeRoute,
  Entitlements,
  ContributorProfile,
  InstructorStatus,
  RecordedJourney,
  SignedPartsResult,
  ReferenceRoute,
  UploadInitResult,
  UploadStatus,
  TestCentre,
  TestCentreDetail,
  TestCentreInput,
  PostcodeLookup,
  ContactDetailsInput,
  TestDetails,
  TestDetailRecord,
  Me,
  InstructorSearchResult,
  InstructorBookingProfile,
  AvailabilitySlot,
  InstructorBooking,
  GpsFixInput,
  StartedJourney,
  JourneyReport,
} from './types';

export type GpsSource = 'camera' | 'embedded' | 'app_journey';

export interface DeclaredFile {
  /** `gps` supersedes `gpx` (Phase 24): several logs per upload is the normal case. */
  kind: 'front' | 'rear' | 'gps' | 'gpx';
  originalName: string;
  contentType: string;
  bytes: number;
  /**
   * The order the instructor confirmed on the review screen. Sent because neither
   * upload order (browsers don't guarantee it) nor mtime (copying rewrites it) is
   * trustworthy, and a human who has looked at the detected order is.
   */
  declaredOrdinal?: number;
  /** Client-probed values shown on the review screen; the worker re-probes. */
  clientStartEpochMs?: number;
  clientDurationMs?: number;
  /**
   * Phase 25: SHA-256 of the file's bytes, computed before upload.
   *
   * Sent up-front so the server can answer "we already hold these bytes" and skip the
   * transfer entirely — deduplication only saves anything if the decision happens before
   * the data moves. The worker re-hashes what actually arrived, so a wrong value costs
   * the client a real upload rather than corrupting anything.
   */
  sha256?: string;
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
  constructor(
    public status: number,
    message: string,
    /**
     * Stable reason identifier from the API, when it sends one (e.g. `email_not_verified`).
     * Branch on this rather than on `message`, which is copy and will change.
     */
    public code?: string,
  ) {
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
    throw new ApiError(res.status, body.title || body.detail || `HTTP ${res.status}`, body.code);
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
  register: (
    email: string,
    password: string,
    displayName: string,
    contact?: ContactDetailsInput,
  ) =>
    request<{ accessToken: string; refreshToken: string }>('/auth/register', {
      method: 'POST',
      // Spread rather than always sending the keys: the API treats an absent field as
      // "leave alone" and an empty string as "clear", so sending '' at signup would be a
      // pointless instruction to clear something that was never set.
      body: JSON.stringify({ email, password, displayName, ...(contact ?? {}) }),
    }),

  /**
   * Ask for a password-reset link (Phase 28).
   *
   * Always resolves, whether or not the address is registered — the API deliberately
   * gives the same answer either way so this endpoint can't be used to find out who has
   * an account. The UI must therefore never phrase the result as "we found you".
   */
  forgotPassword: (email: string) =>
    request<{ ok: true }>('/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ email }),
    }),

  /** Redeem a reset link and set a new password. */
  resetPassword: (token: string, password: string) =>
    request<{ reset: true }>('/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify({ token, password }),
    }),

  /** Redeem an email-verification link. */
  verifyEmail: (token: string) =>
    request<{ verified: true }>('/auth/verify-email', {
      method: 'POST',
      body: JSON.stringify({ token }),
    }),

  /** Resend the verification email to the signed-in user's own address. */
  resendVerification: () =>
    request<{ ok: true }>('/auth/verify-email/resend', { method: 'POST' }),

  /** Update the signed-in user's own profile / contact details. */
  updateMe: (patch: ContactDetailsInput & { displayName?: string; avatarUrl?: string }) =>
    request<Me>('/users/me', { method: 'PATCH', body: JSON.stringify(patch) }),

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
  /** Postcode → town / region / coordinates, so the centre form can fill itself in. */
  lookupPostcode: (postcode: string) =>
    request<PostcodeLookup>(
      `/test-centres/lookup/postcode?postcode=${encodeURIComponent(postcode)}`,
    ),
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
  submitInstructor: (
    adiNumber: string,
    adiExpiry: string,
    evidenceUrl?: string,
    evidenceKey?: string,
  ) =>
    request<{ status: string }>('/instructors/verify', {
      method: 'POST',
      body: JSON.stringify({ adiNumber, adiExpiry, evidenceUrl, evidenceKey }),
    }),

  /**
   * Ask for somewhere to put a photo of an ADI badge. Returns a presigned PUT that the
   * browser uploads to directly, so the image never passes through the API.
   */
  badgeEvidenceUpload: (contentType: string, bytes: number) =>
    request<{ key: string; uploadUrl: string; contentType: string }>(
      '/instructors/verify/evidence-upload',
      { method: 'POST', body: JSON.stringify({ contentType, bytes }) },
    ),

  // --- booking a driving instructor (Phase 27) ---

  /**
   * Instructors a learner can book. `nearby` is within the instructor's stated travel
   * radius of the postcode; `elsewhere` is only populated when there is nothing local, so
   * an area with no coverage yet still has something to show.
   */
  searchInstructors: (params: { postcode?: string; maxPriceMinor?: number; page?: number }) => {
    const qs = new URLSearchParams();
    if (params.postcode?.trim()) qs.set('postcode', params.postcode.trim());
    if (params.maxPriceMinor != null) qs.set('maxPrice', String(params.maxPriceMinor));
    if (params.page) qs.set('page', String(params.page));
    const q = qs.toString();
    return request<InstructorSearchResult>(`/instructors${q ? `?${q}` : ''}`);
  },

  /** The signed-in instructor's own bookable profile (price, bio, base postcode). */
  myInstructorProfile: (userId: string) =>
    request<InstructorBookingProfile>(`/instructors/${userId}/profile`),
  updateMyInstructorProfile: (patch: {
    bio?: string;
    lessonPriceMinor?: number;
    yearsExperience?: number;
    isAcceptingBookings?: boolean;
    basePostcode?: string;
    travelRadiusKm?: number;
  }) =>
    request<InstructorBookingProfile>('/instructors/me/profile', {
      method: 'PUT',
      body: JSON.stringify(patch),
    }),

  myAvailability: (from?: string) =>
    request<AvailabilitySlot[]>(
      `/instructors/me/slots${from ? `?from=${encodeURIComponent(from)}` : ''}`,
    ),
  addAvailability: (slotDate: string, startTime: string, endTime: string) =>
    request<{ ok: boolean }>('/instructors/me/slots', {
      method: 'POST',
      body: JSON.stringify({ slotDate, startTime, endTime }),
    }),
  deleteAvailability: (slotId: string) =>
    request<{ ok: boolean }>(`/instructors/me/slots/${slotId}`, { method: 'DELETE' }),
  myInstructorBookings: () => request<InstructorBooking[]>('/instructors/me/bookings'),

  initUpload: (payload: {
    title: string;
    description?: string;
    testCentreId?: string;
    clockSource?: string;
    files: DeclaredFile[];
    // ---- Phase 24 recording provenance ----
    gpsSource?: GpsSource;
    /** Required when `gpsSource === 'app_journey'` — the recorded drive to attach to. */
    journeyId?: string;
    /** The R1 this drive claims to replicate; conformance is checked against it. */
    referenceRouteId?: string;
    /** Correction for a dashcam with a wrong clock (timezone/DST/unset). Signed ms. */
    cameraClockOffsetMs?: number;
    timelineReviewed?: boolean;
  }) => request<UploadInitResult>('/uploads', { method: 'POST', body: JSON.stringify(payload) }),

  // Phase 24 — the upload wizard needs the R1 list and (for UC2) the instructor's own
  // recorded journeys to attach dashcam footage to.
  listReferenceRoutes: (testCentreId?: string) =>
    request<ReferenceRoute[]>(
      `/reference-routes${testCentreId ? `?testCentreId=${encodeURIComponent(testCentreId)}` : ''}`,
    ),
  myJourneys: () => request<RecordedJourney[]>('/instructors/me/journeys'),

  // --- recording a drive in the browser (Phase 27) ---
  // A journey is always recorded against a reference route (R1): conformance is checked
  // against it, so there is nothing to record without one.

  startJourney: (referenceRouteId: string, videoSource: 'phone' | 'dashcam' = 'dashcam') =>
    request<StartedJourney>('/journeys', {
      method: 'POST',
      body: JSON.stringify({ referenceRouteId, videoSource }),
    }),

  /**
   * Submit the recorded track. The server runs the conformance analysis and returns the
   * verdict, so the instructor learns whether the drive is usable before they spend an hour
   * uploading footage for it.
   */
  submitJourney: (journeyId: string, fixes: GpsFixInput[], videoSource?: 'phone' | 'dashcam') =>
    request<JourneyReport>(`/journeys/${journeyId}/submit`, {
      method: 'POST',
      body: JSON.stringify({ fixes, videoSource }),
    }),
  completeUpload: (id: string) =>
    request<{ uploadId: string; status: string }>(`/uploads/${id}/complete`, { method: 'POST' }),
  uploadStatus: (id: string) => request<UploadStatus>(`/uploads/${id}`),

  // ---- Phase 25: multipart upload for large files ----

  /**
   * Sign the next batch of parts. Called repeatedly during a large upload rather than
   * once at the start: every signed URL shares the same short expiry, so signing all of
   * a 5 GB file's parts up front would leave the later ones dead on a slow connection.
   */
  signUploadParts: (uploadId: string, fileId: string, partNumbers: number[]) =>
    request<SignedPartsResult>(`/uploads/${uploadId}/parts`, {
      method: 'POST',
      body: JSON.stringify({ fileId, partNumbers }),
    }),

  /** Assemble the uploaded parts into the final object. */
  completeUploadParts: (
    uploadId: string,
    fileId: string,
    parts: Array<{ partNumber: number; etag: string }>,
  ) =>
    request<{ fileId: string; key: string; bytes: number | null }>(
      `/uploads/${uploadId}/parts/complete`,
      { method: 'POST', body: JSON.stringify({ fileId, parts }) },
    ),

  /**
   * Cancel an upload and release whatever already reached the bucket.
   *
   * Worth calling on an explicit cancel: it reclaims the storage immediately instead of
   * waiting for the nightly orphan sweep. Only ever removes objects nothing references.
   */
  abortUpload: (uploadId: string) =>
    request<{ uploadId: string; objectsDeleted: number; bytesReclaimed: number }>(
      `/uploads/${uploadId}`,
      { method: 'DELETE' },
    ),
};
