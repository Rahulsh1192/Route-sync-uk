// Client-side demo mode: lets the app be explored without the backend running.
// Enabled via a flag in localStorage; the API client short-circuits to this data.
import type {
  RouteSummary,
  PlaybackManifest,
  PracticeRoute,
  Entitlements,
} from './types';

const DEMO_KEY = 'rs_demo';

export const demo = {
  get on() {
    return localStorage.getItem(DEMO_KEY) === '1';
  },
  enable() {
    localStorage.setItem(DEMO_KEY, '1');
  },
  disable() {
    localStorage.removeItem(DEMO_KEY);
  },
};

// A public, CORS-enabled HLS test stream so the player genuinely plays video.
const DEMO_HLS = 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8';

export const demoRoutes: RouteSummary[] = [
  {
    id: 'demo-millhill',
    title: 'Mill Hill test route',
    town: 'Mill Hill',
    postcode: 'NW7',
    difficulty: 'test_standard',
    distanceM: 8200,
    durationS: 1500,
    junctionCount: 12,
    roundaboutCount: 4,
    qualityScore: 86,
    isSample: true,
    isInstructor: true,
  },
  {
    id: 'demo-isleworth',
    title: 'Isleworth town loop',
    town: 'Isleworth',
    postcode: 'TW7',
    difficulty: 'intermediate',
    distanceM: 6100,
    durationS: 1080,
    junctionCount: 9,
    roundaboutCount: 3,
    qualityScore: 74,
  },
  {
    id: 'demo-yeading',
    title: 'Yeading residential & dual carriageway',
    town: 'Hayes',
    postcode: 'UB4',
    difficulty: 'beginner',
    distanceM: 5400,
    durationS: 960,
    junctionCount: 7,
    roundaboutCount: 2,
    qualityScore: 68,
  },
];

export function demoPlayback(routeId: string): PlaybackManifest {
  return {
    routeId,
    durationS: 60,
    syncConfidence: 0.82,
    streams: [
      { view: 'front', url: DEMO_HLS, syncOffsetMs: 0 },
      { view: 'rear', url: DEMO_HLS, syncOffsetMs: 0 },
    ],
    markers: [
      { t_ms: 8000, kind: 'junction', label: 'Turn left onto the High Street' },
      { t_ms: 22000, kind: 'roundabout', label: 'Roundabout — second exit' },
      { t_ms: 41000, kind: 'junction', label: 'Turn right at the lights' },
    ],
  };
}

export function demoPractice(routeId: string): PracticeRoute {
  return {
    routeId,
    voice: 'en-GB',
    summary: {
      distanceM: 8200,
      durationS: 1500,
      junctionCount: 12,
      roundaboutCount: 4,
      difficulty: 'test_standard',
    },
    instructions: [
      { seq: 0, t_ms: 0, type: 'start', text_ukenglish: 'Start the route when ready' },
      { seq: 1, t_ms: 4000, type: 'turn_left', text_ukenglish: 'In 200 yards, turn left onto the High Street' },
      { seq: 2, t_ms: 10000, type: 'continue', text_ukenglish: 'Continue straight ahead', speed_limit_mph: 30 },
      { seq: 3, t_ms: 16000, type: 'roundabout_exit', text_ukenglish: 'At the roundabout, take the second exit', roundabout_exit: 2 },
      { seq: 4, t_ms: 24000, type: 'turn_right', text_ukenglish: 'Turn right at the traffic lights' },
      { seq: 5, t_ms: 32000, type: 'continue', text_ukenglish: 'Follow the road for half a mile', speed_limit_mph: 40 },
      { seq: 6, t_ms: 42000, type: 'destination', text_ukenglish: 'You have reached the end of the route' },
    ],
  };
}

export const demoEntitlements: Entitlements = {
  plan: 'premium_yearly',
  status: 'active',
  currentPeriodEnd: null,
  premiumTestCentreIds: [null], // universal grant in demo mode
  entitlements: {
    unlimitedRoutes: true,
    practiceMode: true,
    multiView: true,
    offline: true,
    instructorRoutes: true,
  },
};
