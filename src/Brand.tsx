/**
 * Shared brand mark for Momentum: a small trail of circles that grow in
 * size and opacity toward a solid leading circle with an orange "spark" —
 * motion building, read the same way the app reads a trajectory.
 * All circles stay well inside the 32x32 viewBox (>=2 units of margin)
 * so nothing clips against the box at any render size.
 */
export function MomentumMark({ small = false }: { small?: boolean }) {
  return (
    <svg
      className={`momentum-mark${small ? " small" : ""}`}
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
    >
      <circle className="momentum-trail-1" cx="7" cy="25" r="2.6" />
      <circle className="momentum-trail-2" cx="13" cy="19" r="3.8" />
      <circle className="momentum-trail-3" cx="19" cy="13" r="5" />
      <circle className="momentum-lead" cx="23.5" cy="8.5" r="6.3" />
      <circle className="momentum-spark" cx="23.5" cy="8.5" r="2" />
    </svg>
  );
}
