/** Footage-licensing agreement contributors must accept before uploading. */
export const CURRENT_AGREEMENT_VERSION = '2026-01';

/** Credits awarded per published route, with a quality bonus. */
export const CREDITS_PER_ROUTE = 10;
export const HIGH_QUALITY_BONUS = 5;
export const HIGH_QUALITY_THRESHOLD = 80;

/** Badge catalogue (seeded idempotently into the badges table at boot). */
export interface BadgeRule {
  code: string;
  name: string;
  description: string;
}
export const BADGES: BadgeRule[] = [
  { code: 'first_route', name: 'First Route', description: 'Published your first route' },
  { code: 'ten_routes', name: 'Trailblazer', description: 'Published 10 routes' },
  { code: 'fifty_routes', name: 'Road Master', description: 'Published 50 routes' },
  { code: 'high_quality', name: 'Quality Contributor', description: 'Maintained a high average quality score' },
  { code: 'instructor', name: 'Verified Instructor', description: 'Verified ADI instructor' },
];

export const HIGH_QUALITY_BADGE_MIN_ROUTES = 5;
export const HIGH_QUALITY_BADGE_AVG = 85;
