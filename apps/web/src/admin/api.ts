// Typed API client for the admin console. Reuses the shared web auth
// (bearer token + refresh) from ../api/client, so there is one login for the
// whole app rather than a separate admin token.
import { api as webApi, ApiError } from '../api/client';
export { ApiError };

function request<T>(path: string, init?: RequestInit): Promise<T> {
  return webApi.request<T>(path, init);
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
  // Phase 26 contact details. Nullable: existing accounts and OAuth sign-ins predate them.
  phone: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
}

/** A test centre, for the reference-route panel's picker. */
export interface AdminTestCentre {
  id: string;
  name: string;
  town: string | null;
  postcode: string | null;
}

/** An examiner's canonical route (R1) that contributed drives are checked against. */
export interface AdminReferenceRoute {
  id: string;
  name: string;
  startLabel: string | null;
  endLabel: string | null;
  testCentreId: string | null;
  lengthM: number | null;
  pointCount: number | null;
  createdAt?: string;
}
export interface PendingInstructor {
  id: string;
  user_id: string;
  adi_number: string;
  /** Phase 26. Null on submissions made before the expiry was collected. */
  adi_expiry: string | null;
  adiExpired: boolean;
  evidence_url: string | null;
  display_name: string;
  email: string | null;
  phone: string | null;
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
export interface RevshareRun {
  period: string;
  status: string;
  grossMinor: number;
  poolMinor: number;
  platformMinor: number;
  config: { instructorPct?: number; grossSource?: 'invoices' | 'estimate' } | null;
  createdAt: string;
}
export interface RevshareRunLine {
  instructorId: string;
  instructorName: string | null;
  testCentreId: string | null;
  testCentreName: string | null;
  watchSeconds: number;
  sharePct: string;
  amountMinor: number;
}
export interface RevshareRunDetail {
  run: RevshareRun & { id: string };
  lines: RevshareRunLine[];
}
export interface RevshareInstructor {
  instructorId: string;
  instructorName: string | null;
  balanceMinor: number;
  accruedMinor: number;
  paidMinor: number;
  lastEntryAt: string | null;
}

export const api = {
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

  adminBookings: (page = 0) =>
    request<any[]>(`/admin/bookings?page=${page}`),

  // --- reference routes (R1) ---
  // Reuses the existing public/instructor endpoints rather than adding admin-only
  // duplicates: the same data, and `POST /reference-routes` is already role-guarded to
  // instructor+admin.
  testCentres: () => request<AdminTestCentre[]>('/test-centres'),
  referenceRoutes: (testCentreId?: string) =>
    request<AdminReferenceRoute[]>(
      `/reference-routes${testCentreId ? `?testCentreId=${encodeURIComponent(testCentreId)}` : ''}`,
    ),
  createReferenceRoute: (input: {
    testCentreId?: string;
    name: string;
    startLabel?: string;
    endLabel?: string;
    points: Array<{ lat: number; lng: number }>;
  }) =>
    request<AdminReferenceRoute>('/reference-routes', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  // instructor rev-share (shadow reporting)
  revshareRuns: () => request<RevshareRun[]>('/admin/revshare/runs'),
  revshareRunDetail: (period: string) =>
    request<RevshareRunDetail>(`/admin/revshare/runs/${encodeURIComponent(period)}`),
  revshareInstructors: () => request<RevshareInstructor[]>('/admin/revshare/instructors'),
  runRevshare: (period?: string) =>
    request<{ period: string; grossMinor?: number; poolMinor?: number; skipped?: boolean }>(
      '/admin/revshare/run',
      { method: 'POST', body: JSON.stringify(period ? { period } : {}) },
    ),
};
