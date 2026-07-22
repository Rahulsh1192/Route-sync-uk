import { useNavigate } from 'react-router-dom';

/**
 * Instructor avatar + name (+ verified badge). Clicking opens the instructor's
 * profile. Stops event propagation so it works inside a clickable RouteCard.
 */
export function InstructorByline({
  id,
  name,
  avatar,
  verified,
}: {
  id?: string | null;
  name?: string | null;
  avatar?: string | null;
  verified?: boolean;
}) {
  const nav = useNavigate();
  if (!name) return null;
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');

  return (
    <span
      className="instructor-byline"
      role={id ? 'link' : undefined}
      tabIndex={id ? 0 : undefined}
      onClick={(e) => {
        if (!id) return;
        e.stopPropagation();
        nav(`/instructors/${id}`);
      }}
      onKeyDown={(e) => {
        if (id && e.key === 'Enter') {
          e.stopPropagation();
          nav(`/instructors/${id}`);
        }
      }}
      title={verified ? `${name} · Verified instructor` : name}
    >
      {avatar ? (
        <img className="instructor-avatar" src={avatar} alt="" />
      ) : (
        <span className="instructor-avatar" aria-hidden="true">
          {initials}
        </span>
      )}
      <span className="instructor-name">{name}</span>
      {verified && (
        <span className="verified-badge" aria-label="Verified instructor" title="Verified instructor">
          ✓
        </span>
      )}
    </span>
  );
}
