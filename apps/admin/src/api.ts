// Minimal typed API client for the admin dashboard.
// Stores the bearer token in localStorage and attaches it to every request.

const TOKEN_KEY = 'routesync_admin_token';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}
export function setToken(token: string | null) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getToken();
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, body.title || body.detail || `HTTP ${res.status}`);
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

// --- types ---
export interface ReviewRoute {
  id: string;
  title: string;
  status: string;
  qualityScore: number | null;
  syncConfidence: string | null;
  isInstructor: boolean;
  contributorId: string;
  createdAt: string;
}
export interface Analytics {
  users: number;
  publishedRoutes: number;
  premiumSubscribers: number;
  pendingReview: number;
}
export interface Stage {
  stage: string;
  state: string;
  progress: string;
  findings: unknown;
  finished_at: string | null;
}
export interface RouteDetail {
  route: Record<string, unknown> & { id: string; title: string; status: string };
  stages: Stage[];
  videos: Array<{ view: string; rendition: string; width: number; height: number; duration_s: string }>;
  quality: Record<string, number> | null;
  thumbnailUrl: string | null;
}
export interface AdminUser {
  id: string;
  email: string | null;
  displayName: string;
  role: string;
  isSuspended: boolean;
  createdAt: string;
}
export interface PendingInstructor {
  id: string;
  user_id: string;
  adi_number: string;
  evidence_url: string | null;
  display_name: string;
  email: string | null;
  created_at: string;
}
export interface Revenue {
  activeMonthly: number;
  activeYearly: number;
  mrrFormatted: string;
  breakdown: Array<{ plan: string; status: string; _count: { _all: number } }>;
}
export interface Beneficiary {
  id: string;
  name: string;
  description: string | null;
  user_id: string | null;
  created_at: string;
}
export interface FundSummary {
  allocationPct: number;
  costRatio: number;
  contributedMinor: number;
  paidOutMinor: number;
  balanceMinor: number;
  totals: Array<{ entry_type: string; total: string }>;
  recent: Array<{
    entry_type: string;
    amount_minor: string;
    currency: string;
    period: string | null;
    description: string | null;
    created_at: string;
  }>;
  beneficiaries: Beneficiary[];
}
export interface Report {
  id: string;
  target_type: string;
  target_id: string;
  reason: string;
  status: string;
  created_at: string;
}

export const api = {
  login: (email: string, password: string) =>
    request<{ accessToken: string }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),

  analytics: () => request<Analytics>('/admin/analytics'),
  reviewQueue: () => request<ReviewRoute[]>('/admin/review-queue'),
  routeDetail: (id: string) => request<RouteDetail>(`/admin/routes/${id}`),
  moderate: (id: string, decision: 'approve' | 'reject', reason?: string) =>
    request<{ id: string; status: string }>(`/admin/routes/${id}/moderate`, {
      method: 'POST',
      body: JSON.stringify({ decision, reason }),
    }),

  users: (q?: string) => request<AdminUser[]>(`/admin/users${q ? `?q=${encodeURIComponent(q)}` : ''}`),
  updateUser: (id: string, data: { role?: string; isSuspended?: boolean }) =>
    request<AdminUser>(`/admin/users/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),

  pendingInstructors: () => request<PendingInstructor[]>('/admin/instructors'),
  verifyInstructor: (id: string, decision: 'verified' | 'rejected', notes?: string) =>
    request<{ id: string; status: string }>(`/admin/instructors/${id}/verify`, {
      method: 'POST',
      body: JSON.stringify({ decision, notes }),
    }),

  revenue: () => request<Revenue>('/admin/revenue'),
  reports: () => request<Report[]>('/admin/reports'),
  fundSummary: () => request<FundSummary>('/admin/fund/summary'),
  allocateFund: (amountMinor: number, period: string, description?: string) =>
    request<{ ok: boolean }>('/admin/fund/allocate', {
      method: 'POST',
      body: JSON.stringify({ amountMinor, period, description }),
    }),
  addBeneficiary: (name: string, description?: string) =>
    request<{ id: string }>('/admin/fund/beneficiaries', {
      method: 'POST',
      body: JSON.stringify({ name, description }),
    }),
  fundPayout: (beneficiaryId: string, amountMinor: number, description?: string) =>
    request<{ ok: boolean }>('/admin/fund/payout', {
      method: 'POST',
      body: JSON.stringify({ beneficiaryId, amountMinor, description }),
    }),
  runFundContribution: () =>
    request<{ period: string; fundMinor?: number; skipped?: boolean }>('/admin/fund/run-contribution', {
      method: 'POST',
      body: JSON.stringify({}),
    }),
};
