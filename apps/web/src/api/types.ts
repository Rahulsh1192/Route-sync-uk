export interface RouteSummary {
  id: string;
  title: string;
  town?: string | null;
  postcode?: string | null;
  difficulty?: string | null;
  distanceM?: number | null;
  durationS?: number | null;
  junctionCount?: number | null;
  roundaboutCount?: number | null;
  qualityScore?: number | null;
  isSample?: boolean;
  isInstructor?: boolean;
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

export interface PlaybackManifest {
  routeId: string;
  durationS: number;
  syncConfidence?: number | null;
  streams: VideoStream[];
  markers: RouteMarker[];
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
  entitlements: {
    unlimitedRoutes: boolean;
    practiceMode: boolean;
    multiView: boolean;
    offline: boolean;
    instructorRoutes: boolean;
  };
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

export interface UploadTarget {
  kind: 'front' | 'rear' | 'gpx';
  key: string;
  uploadUrl: string;
}

export interface UploadInitResult {
  uploadId: string;
  routeId: string;
  targets: UploadTarget[];
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

export function distanceLabel(m?: number | null): string {
  return m == null ? '—' : `${(m / 1000).toFixed(1)} km`;
}
export function durationLabel(s?: number | null): string {
  return s == null ? '—' : `${Math.round(s / 60)} min`;
}
