/** Instructor byline attached to routes (flattened from the contributor). */
export interface RouteInstructor {
  instructorId?: string | null;
  instructorName?: string | null;
  instructorAvatar?: string | null;
  instructorVerified?: boolean;
}

export interface RouteSummary extends RouteInstructor {
  id: string;
  title: string;
  town?: string | null;
  postcode?: string | null;
  difficulty?: string | null;
  testCentreId?: string | null;
  distanceM?: number | null;
  durationS?: number | null;
  junctionCount?: number | null;
  roundaboutCount?: number | null;
  qualityScore?: number | null;
  isSample?: boolean;
  isInstructor?: boolean;
}

export interface Me {
  id: string;
  email?: string | null;
  displayName: string;
  avatarUrl?: string | null;
  role: string;
  locale?: string;
  createdAt?: string;
}

/** True for staff who can manage test centres / upload routes (matches the API's
 * `@Roles('instructor','admin')` on those endpoints). Moderators use the admin
 * console, not the content-management buttons in the learner app. */
export function isStaffRole(role?: string | null): boolean {
  return role === 'instructor' || role === 'admin';
}

/** A signed-up member who isn't yet staff — eligible to apply to be an instructor. */
export function canApplyAsInstructor(role?: string | null): boolean {
  return role === 'user' || role === 'contributor';
}

export interface VideoStream {
  view: 'front' | 'rear';
  url: string;
  syncOffsetMs: number;
}

export interface RouteMarker {
  t_ms: number;
  kind: string;
  label?: string | null;
}

/**
 * One GPS position on the playback clock (Phase 24).
 *
 * `tMs` is VIDEO time, not wall-clock time — the worker already mapped it through the
 * clip timeline, so the player can use it directly against the video's currentTime
 * without knowing anything about inter-clip gaps.
 *
 * Positions are snapped onto the reference route (R1) by the conformance engine, so
 * what the learner sees is the canonical route rather than the recording's GPS noise.
 */
export interface TrackPoint {
  tMs: number;
  lat: number;
  lng: number;
  speedMps?: number | null;
  bearingDeg?: number | null;
}

/**
 * Per-clip mapping between concatenated-video time and real time. Playback runs on
 * video time, so this is only needed to display a true timestamp or reason about the
 * recording — but it's the reason video time is trustworthy in the first place.
 */
export interface ClipTimelineEntry {
  view: 'front' | 'rear';
  clipSeq: number;
  videoStartMs: number;
  videoEndMs: number;
  wallStartEpochMs: number;
  gapBeforeMs: number;
}

export interface PlaybackManifest {
  routeId: string;
  durationS: number;
  syncConfidence?: number | null;
  streams: VideoStream[];
  markers: RouteMarker[];
  /** Phase 24 — drives the moving map marker. Empty for routes processed pre-24. */
  track?: TrackPoint[];
  clipTimeline?: ClipTimelineEntry[];
}

export interface RouteTrackResponse {
  routeId: string;
  durationS: number | null;
  distanceM: number | null;
  pointCount: number;
  track: TrackPoint[];
}

export interface Instruction {
  seq: number;
  t_ms: number;
  type: string;
  text_ukenglish: string;
  roundabout_exit?: number | null;
  speed_limit_mph?: number | null;
}

export interface PracticeRoute {
  routeId: string;
  voice: string;
  summary?: {
    distanceM?: number | null;
    durationS?: number | null;
    junctionCount?: number | null;
    roundaboutCount?: number | null;
    difficulty?: string | null;
  };
  instructions: Instruction[];
}

export interface Entitlements {
  plan: string;
  status: string;
  currentPeriodEnd?: string | null;
  // Test centres the user has active Premium for. `null` in the list means a
  // legacy/universal subscription (covers every centre). Undefined on older
  // API responses / demo mode — callers fall back to the flags below.
  premiumTestCentreIds?: Array<string | null>;
  entitlements: {
    unlimitedRoutes: boolean;
    practiceMode: boolean;
    multiView: boolean;
    offline: boolean;
    instructorRoutes: boolean;
  };
}

export interface RouteDetail extends RouteInstructor {
  id: string;
  title: string;
  description?: string | null;
  town?: string | null;
  postcode?: string | null;
  difficulty?: string | null;
  testCentreId?: string | null;
  testCentre?: TestCentre | null;
  isSample?: boolean;
  isInstructor?: boolean;
  distanceM?: number | null;
  durationS?: number | null;
  junctionCount?: number | null;
  roundaboutCount?: number | null;
  qualityScore?: number | null;
}

/**
 * True if the user has Premium access for the given test centre. A `null` entry
 * in `premiumTestCentreIds` is a universal grant. When the field is absent
 * (older API / demo), fall back to the account-wide multiView flag.
 */
export function hasCentreAccess(
  ent: Entitlements | null,
  testCentreId: string | null | undefined,
): boolean {
  if (!ent) return false;
  const centres = ent.premiumTestCentreIds;
  if (centres === undefined) return ent.entitlements.multiView;
  if (centres.includes(null)) return true; // universal / legacy grant
  return testCentreId != null && centres.includes(testCentreId);
}

export interface RouteAccess {
  allowed: boolean;
  reason: 'ok' | 'PAYWALL';
  testCentreId: string | null;
  centreLabel: string;
}

export interface TestCentre {
  id: string;
  name: string;
  town?: string | null;
  postcode?: string | null;
  region?: string | null;
  address?: string | null;
  description?: string | null;
  lat?: number | null;
  lng?: number | null;
  routeCount?: number;
}

export interface TestCentreDetail {
  centre: TestCentre;
  routes: RouteSummary[];
}

export interface TestCentreInput {
  name: string;
  postcode: string;
  town?: string;
  region?: string;
  address?: string;
  description?: string;
}

export interface TestDetailRecord {
  id: string;
  testCentreId: string;
  testDate: string; // ISO date
  createdAt: string;
}

export interface TestDetails {
  current: TestDetailRecord | null;
  history: TestDetailRecord[];
}

export interface Badge {
  code: string;
  name: string;
  description: string;
  awarded_at?: string;
}

export interface ContributorProfile {
  id: string;
  display_name: string;
  avatar_url: string | null;
  credits: number;
  reputation: number;
  routes_published: number;
  instructor_status: string;
  bio: string | null;
  badges: Badge[];
}

/**
 * What the client must do for one declared file. Exactly one of three shapes, so the
 * client never has to infer the upload strategy from sizes or guesswork:
 *   * `deduplicated` — identical bytes already exist server-side; upload nothing.
 *   * `uploadUrl`    — single presigned PUT (small files).
 *   * `multipart`    — request part URLs and PUT them in parallel (large files).
 */
export interface UploadTarget {
  fileId: string;
  kind: 'front' | 'rear' | 'gps' | 'gpx';
  key: string;
  deduplicated: boolean;
  uploadUrl: string | null;
  multipart?: {
    uploadId: string;
    partSizeBytes: number;
    partsTotal: number;
  };
}

export interface UploadInitResult {
  uploadId: string;
  routeId: string;
  targets: UploadTarget[];
}

/** Signed URLs for a batch of multipart parts. */
export interface SignedPartsResult {
  fileId: string;
  key: string;
  partSizeBytes: number;
  partsTotal: number;
  parts: Array<{ partNumber: number; uploadUrl: string }>;
}

/** A canonical examiner route (R1) an upload is checked against. */
export interface ReferenceRoute {
  id: string;
  name: string;
  startLabel?: string | null;
  endLabel?: string | null;
  testCentreId?: string | null;
  lengthM: number;
  pointCount: number;
  createdAt?: string;
}

/**
 * A drive the instructor recorded in the app (UC2). `attachable` is false once footage
 * has been attached, or when the journey holds no usable GPS — surfaced rather than
 * hidden so the picker can explain why a remembered drive isn't offered.
 */
export interface RecordedJourney {
  id: string;
  referenceRouteId: string;
  referenceRouteName?: string | null;
  videoSource: string;
  status: string;
  verdict?: string | null;
  coveragePct?: number | null;
  startedAt: string;
  startedAtEpochMs?: number | null;
  submittedAt?: string | null;
  uploadId?: string | null;
  videoUploadState?: string | null;
  pointCount?: number | null;
  durationMs?: number | null;
  attachable: boolean;
}

export interface UploadStage {
  stage: string;
  state: string;
  progress: string | number;
  findings: unknown;
  started_at: string | null;
  finished_at: string | null;
}

export interface UploadStatus {
  upload: { id: string; status: string; error: string | null };
  stages: UploadStage[];
}

export interface InstructorStatus {
  instructor_status: string;
  adi_number?: string | null;
  verified_at?: string | null;
}

/** Distance shown in miles (Phase 20 — UK convention). */
export function distanceLabel(m?: number | null): string {
  return m == null ? '—' : `${(m / 1609.344).toFixed(1)} mi`;
}
export function durationLabel(s?: number | null): string {
  return s == null ? '—' : `${Math.round(s / 60)} min`;
}
