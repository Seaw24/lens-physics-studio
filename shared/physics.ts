export type Concept = "force" | "torque" | "equilibrium" | "projectile";
export type EvidenceKind = "observed" | "assumed" | "practice";
export interface Evidence {
  label: string;
  value: string;
  kind: EvidenceKind;
}
export interface Anchor {
  x: number;
  y: number;
  label: string;
  type: "point" | "hinge" | "force" | "motion";
  dx?: number;
  dy?: number;
}
export interface GeneratedQuestion {
  id: string;
  prompt: string;
  options: string[];
  correct: number;
  explanation: string;
  hint: string;
}
export interface Moment {
  id: string;
  title: string;
  shortTitle: string;
  subtitle: string;
  concept: Concept;
  time: number;
  end: number;
  observation: string;
  question: string;
  principle: string;
  source: "curated" | "bedrock";
  evidence: Evidence[];
  anchors: Anchor[];
  context: string;
  trace?: { time: number; x: number; y: number }[];
  /** Escalating multiple-choice sequence generated for this specific detected
   * situation (predict -> distinguish/test -> transfer). 1 item when evidence
   * is limited, up to 3 when the evidence is rich enough to support a full
   * teaching progression. Falls back to legacy hardcoded per-concept content
   * in the UI when absent. */
  questions?: GeneratedQuestion[];
  /** AI's own honest assessment of how strong the visual evidence for this
   * moment is; drives how many questions get generated. */
  evidenceLevel?: "rich" | "limited";
}
export interface Message {
  role: "user" | "assistant";
  content: string;
}
export interface TutorReply {
  reply: string;
  mode: "bedrock" | "rehearsal";
  highlight?: string;
}
export interface LearningRecord {
  id: string;
  momentId: string;
  title: string;
  concept: Concept;
  answer: string;
  reflection: string;
  completedAt: string;
  hints: number;
  mode: string;
}
export const LEGACY_COURSE = {
  id: "PHYS 2010",
  title: "Forces & rotational motion",
  week: "Week 04",
  instructor: "Dr. Elena Park",
  description:
    "Connect everyday motion to Newton’s laws, then discover how a force creates a turning effect.",
  objectives: [
    "Distinguish velocity from acceleration",
    "Identify the direction of net force",
    "Use the perpendicular moment arm to reason about torque",
    "Explain balance using net force and net torque",
  ],
  notes: [
    {
      id: "4.1",
      title: "Motion is not a force",
      body: "In an inertial frame, the net force on an object equals its mass times its acceleration: ΣF = ma. A rightward-moving object that slows down has leftward acceleration and a leftward net horizontal force. Velocity and net force need not have the same direction.",
    },
    {
      id: "4.2",
      title: "The turning effect of a force",
      body: "Torque about a chosen axis is τ = rF sin θ. Here r is the distance from the axis to the point of application, F is force, and θ is the angle between r and F. For a perpendicular push, τ = rF. The unit is N·m. The perpendicular moment arm is r sin θ.",
    },
    {
      id: "4.3",
      title: "A system in balance",
      body: "Static equilibrium requires zero net force and zero net torque. For an ideal horizontal lever with downward loads, opposite torques balance when F₁r₁ = F₂r₂. State the pivot, force directions, and assumptions before calculating.",
    },
  ],
};
export const LEGACY_MOMENTS: Moment[] = [
  {
    id: "cart",
    title: "Moving right. Force left?",
    shortTitle: "The rolling cart",
    subtitle: "A small moment. A different way to see force.",
    concept: "force",
    time: 48,
    end: 72,
    source: "curated",
    observation:
      "In this illustrated sequence, a released cart moves to the right and slows down.",
    question:
      "The cart is moving to the right and slowing down. Which way does its net horizontal force point?",
    principle: "Net force follows acceleration, not velocity.",
    context: "Courtyard · 08:42",
    evidence: [
      { label: "Motion", value: "Rightward, slowing", kind: "observed" },
      {
        label: "Reference frame",
        value: "Ground, treated as inertial",
        kind: "assumed",
      },
      { label: "Mass & speed", value: "Not measured", kind: "observed" },
    ],
    anchors: [
      { x: 0.55, y: 0.63, label: "Cart", type: "point" },
      { x: 0.6, y: 0.71, label: "Motion", type: "motion", dx: 0.16, dy: 0 },
    ],
  },
  {
    id: "door",
    title: "A little distance goes a long way.",
    shortTitle: "The library door",
    subtitle: "The physics behind where we put a handle.",
    concept: "torque",
    time: 158,
    end: 187,
    source: "curated",
    observation:
      "An illustrated door rotates around its hinge. The handle is far from the hinge.",
    question:
      "To create the same turning effect, would you need more or less force if you pushed closer to the hinge?",
    principle:
      "A longer perpendicular moment arm needs less force for the same torque.",
    context: "Library · 12:16",
    evidence: [
      { label: "Pivot", value: "The door’s hinge", kind: "observed" },
      {
        label: "Push direction",
        value: "Perpendicular in our model",
        kind: "assumed",
      },
      { label: "Practice values", value: "10 N at 0.80 m", kind: "practice" },
    ],
    anchors: [
      { x: 0.39, y: 0.43, label: "Hinge", type: "hinge" },
      { x: 0.63, y: 0.57, label: "Push here", type: "force", dx: -0.1, dy: 0 },
    ],
  },
  {
    id: "balance",
    title: "Different forces. Perfect balance.",
    shortTitle: "A moment of balance",
    subtitle: "What stays the same when the loads are different?",
    concept: "equilibrium",
    time: 286,
    end: 316,
    source: "curated",
    observation:
      "Two illustrative loads sit on opposite sides of a horizontal lever.",
    question:
      "Can a smaller force balance a larger force if it acts farther from the pivot?",
    principle: "Balance the torques about the pivot: F₁r₁ = F₂r₂.",
    context: "Study break · 15:34",
    evidence: [
      { label: "Axis", value: "Central support", kind: "observed" },
      { label: "Lever", value: "Ideal, negligible mass", kind: "assumed" },
      { label: "Practice load", value: "20 N at 0.40 m", kind: "practice" },
    ],
    anchors: [
      { x: 0.5, y: 0.57, label: "Pivot", type: "hinge" },
      { x: 0.36, y: 0.49, label: "Load A", type: "point" },
      { x: 0.7, y: 0.49, label: "Load B", type: "point" },
    ],
  },
];
export const COURSE = {
  id: "PHYS 2010",
  title: "The physics of a basketball shot",
  week: "Week 04",
  instructor: "Dr. Elena Park",
  description:
    "Follow a basketball from release to landing. Connect its path to velocity, acceleration, and the force of gravity.",
  objectives: [
    "Separate horizontal and vertical motion",
    "Distinguish zero vertical velocity from zero acceleration",
    "Explain the downward net force throughout free flight",
    "Use launch speed and angle to predict an ideal trajectory",
  ],
  notes: [
    {
      id: "4.1",
      title: "One path. Two independent motions.",
      body: "In the ideal projectile model, horizontal acceleration is zero and vertical acceleration is −g. The horizontal velocity stays constant. The vertical velocity decreases on the way up, is zero at the highest point, and becomes downward on the way down. This model ignores air resistance and spin.",
    },
    {
      id: "4.2",
      title: "At the top, gravity is still there.",
      body: "After release and before contact, gravity acts downward throughout an ideal basketball flight: ΣF = mg. At the apex, only the vertical component of velocity is zero. The horizontal velocity generally remains nonzero, and the acceleration is still 9.81 m/s² downward near Earth’s surface.",
    },
    {
      id: "4.3",
      title: "Build a prediction you can test.",
      body: "For launch speed v₀ at angle θ, x(t) = v₀ cos θ · t and y(t) = h + v₀ sin θ · t − ½gt². The launch height h, speed, and angle in the sandbox are hypothetical controls. A video trace gives image coordinates; metric speeds need scale calibration, reliable timing, and a suitable camera view.",
    },
  ],
};
export const DEMO_MOMENTS: Moment[] = [
  {
    id: "shot",
    title: "At the top. Still accelerating?",
    shortTitle: "The ball in free flight",
    subtitle: "The ball stops rising. Does gravity stop too?",
    concept: "projectile",
    time: 14.2,
    end: 15.4,
    source: "curated",
    context: "Basketball · Your recording",
    observation:
      "After release, the ball travels toward the basket. The camera follows it, so the image combines ball motion with camera motion. The prepared markers locate the ball; they do not measure its physical trajectory.",
    question:
      "At the highest point of a basketball shot, ignoring air resistance, which way does the net force point?",
    principle:
      "Zero vertical velocity does not mean zero acceleration. Gravity keeps acting downward.",
    evidence: [
      {
        label: "Video trace",
        value: "12 prepared position markers",
        kind: "observed",
      },
      {
        label: "Flight model",
        value: "Air resistance & spin ignored",
        kind: "assumed",
      },
      {
        label: "Launch values",
        value: "Adjustable practice values",
        kind: "practice",
      },
    ],
    anchors: [{ x: 0.4815, y: 0.2063, label: "Ball", type: "point" }],
    trace: [
      { time: 14.2, x: 0.4815, y: 0.2063 },
      { time: 14.3, x: 0.537, y: 0.169 },
      { time: 14.4, x: 0.53, y: 0.129 },
      { time: 14.5, x: 0.533, y: 0.1 },
      { time: 14.6, x: 0.533, y: 0.079 },
      { time: 14.7, x: 0.493, y: 0.0625 },
      { time: 14.8, x: 0.419, y: 0.073 },
      { time: 14.9, x: 0.367, y: 0.094 },
      { time: 15, x: 0.356, y: 0.135 },
      { time: 15.1, x: 0.396, y: 0.19 },
      { time: 15.2, x: 0.452, y: 0.256 },
      { time: 15.3, x: 0.593, y: 0.34 },
    ],
  },
];
export function projectileAt(
  time: number,
  speed: number,
  angle: number,
  height = 2,
  gravity = 9.81,
) {
  const radians = (angle * Math.PI) / 180;
  const vx = speed * Math.cos(radians),
    vy0 = speed * Math.sin(radians);
  return {
    x: vx * time,
    y: height + vy0 * time - 0.5 * gravity * time * time,
    vx,
    vy: vy0 - gravity * time,
    ax: 0,
    ay: -gravity,
  };
}
export function flightTime(
  speed: number,
  angle: number,
  height = 2,
  gravity = 9.81,
) {
  const vy = speed * Math.sin((angle * Math.PI) / 180);
  return (vy + Math.sqrt(vy * vy + 2 * gravity * height)) / gravity;
}
export function torque(force: number, radius: number, angle = 90) {
  return force * radius * Math.sin((angle * Math.PI) / 180);
}
export function requiredForce(target: number, radius: number, angle = 90) {
  const arm = radius * Math.sin((angle * Math.PI) / 180);
  return Math.abs(arm) < 1e-8 ? null : target / arm;
}
export function motionAt(time: number, direction: number) {
  const acceleration = direction * 0.65;
  return {
    position: 2 * time + 0.5 * acceleration * time * time,
    velocity: 2 + acceleration * time,
    acceleration,
  };
}
export function formatTime(seconds: number) {
  const t = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
}
export function parseNumber(value: string) {
  if (!/^\s*[-+]?\d+(?:\.\d+)?\s*(?:N|newtons?)?\s*$/i.test(value)) return null;
  const n = Number.parseFloat(value);
  return Number.isFinite(n) ? n : null;
}
export function assessAnswer(concept: Concept, answer: string) {
  const text = answer.toLowerCase().trim();
  if (concept === "projectile")
    return {
      correct: /^down(?:ward)?$/.test(text),
      feedback:
        "Downward. At the highest point, vertical velocity is zero, but gravity still produces downward acceleration. The ball is still moving horizontally in an angled shot.",
    };
  if (concept === "force")
    return {
      correct:
        /\bleft(?:ward)?\b/.test(text) && !/\bright(?:ward)?\b/.test(text),
      feedback:
        "The net horizontal force points left because the rightward velocity is decreasing.",
    };
  const n = parseNumber(answer);
  const expected = concept === "torque" ? 40 : 10;
  return {
    correct: n !== null && Math.abs(n - expected) < 0.01,
    feedback:
      concept === "torque"
        ? "The moment arm is one-quarter as long, so the force must be four times larger: 40 N."
        : "The left torque is 20 × 0.40 = 8 N·m. At 0.80 m, the balancing force is 10 N.",
  };
}
export function rehearsalReply(
  concept: Concept,
  text: string,
  hintLevel = 0,
): TutorReply {
  const q = text.toLowerCase();
  const wrap = (reply: string, highlight?: string): TutorReply => ({
    reply,
    mode: "rehearsal",
    highlight,
  });
  if (concept === "projectile") {
    if (/\b(zero|no force|stop|paus|rest)\b/.test(q))
      return wrap(
        "It can look like the ball stops at the top. But only its vertical velocity reaches zero. What force would switch off just because the ball reached a particular height? Pause the model at the apex and compare the velocity and gravity arrows.",
        "gravity",
      );
    if (/horizontal|sideways/.test(q))
      return wrap(
        "In our model, there is no horizontal force after release, so horizontal velocity stays constant. Gravity changes the vertical component. Compare the horizontal spacing of the evenly timed dots in the model.",
        "velocity",
      );
    if (/mass|heavy|heavier/.test(q))
      return wrap(
        "Ignoring air resistance, changing mass does not change gravitational acceleration. A heavier ball has more gravitational force, but also proportionally more inertia: F/m = g. With the same launch conditions, the paths match.",
        "gravity",
      );
    if (/angle|speed|range/.test(q))
      return wrap(
        "Try changing one launch condition at a time. A steeper angle gives more initial vertical velocity and less horizontal velocity at the same speed. What happens to the time in the air and the horizontal distance?",
        "velocity",
      );
    if (/trace|video|annotat|measure/.test(q))
      return wrap(
        "Pause the clip at several times and mark the centre of the ball. Those marks are image positions, not metres. A side view with a fixed camera is useful. To measure real speed, you also need a known scale in the plane of motion.",
        "trace",
      );
    if (/down|gravity|answer|explain/.test(q) && hintLevel >= 2)
      return wrap(
        "The net force is downward throughout free flight in this ideal model. Gravity never switches off. At the apex, vy = 0, but ay = −g and vx remains constant. The velocity arrow is horizontal there; the force arrow is downward. Can you explain why zero vertical velocity is different from zero acceleration?",
        "gravity",
      );
    if (/down/.test(q))
      return wrap(
        "Yes—gravity still acts downward at the top. Now pause the model at its apex. Which component of velocity is zero, and which component keeps the ball travelling across the court?",
        "gravity",
      );
    return wrap(
      hintLevel > 0
        ? "Pause at the apex. The vertical velocity arrow disappears, but the gravity arrow stays. The ball changes from moving up to moving down. What does that change tell you about its acceleration?"
        : "Imagine the ball just after it leaves your hand. In our ideal model, gravity is the only force during flight. Is there any reason that force would disappear at the highest point?",
      "gravity",
    );
  }
  if (/\b(unit|units|n.?m|newton)\b/.test(q))
    return wrap(
      concept === "force"
        ? "Force is measured in newtons (N). The direction matters too. Which way is the cart’s velocity changing?"
        : "Torque is measured in newton-metres (N·m): force multiplied by a perpendicular distance. Which distance in this diagram is measured from the pivot?",
      "units",
    );
  if (/\b(answer|solution|show me|explain fully)\b/.test(q) && hintLevel >= 2)
    return wrap(
      concept === "force"
        ? "The net horizontal force is leftward. The cart is moving right, but its rightward velocity is decreasing, so its acceleration points left. Newton’s second law connects net force to that acceleration. Now try describing a cyclist moving left while slowing down."
        : concept === "torque"
          ? "For the practice values, the target torque is 10 × 0.80 = 8 N·m. At 0.20 m, a perpendicular force must be 8 ÷ 0.20 = 40 N. Try explaining why the required force increased without using the equation."
          : "The left load makes 20 × 0.40 = 8 N·m of torque. The right load at 0.80 m needs 8 ÷ 0.80 = 10 N. Why can the smaller force balance the larger one?",
    );
  if (concept === "force") {
    if (/\bleft(?:ward)?\b/.test(q) && !/\bright(?:ward)?\b/.test(q))
      return wrap(
        "Yes—the net force points left. The cart is still moving right, but its velocity is changing toward the left. Can you explain why a rightward force would predict a different result?",
        "force",
      );
    if (/right|forward/.test(q))
      return wrap(
        "Let’s test that idea. A rightward net force makes a rightward-moving cart speed up. In the replay, it slows down. Which arrow would make your model match that change?",
        "force",
      );
    if (/friction/.test(q))
      return wrap(
        "Friction can contribute to a force opposing this motion. The clip alone does not give the size of friction or every individual force. What can the slowing motion tell us about the net horizontal force?",
        "force",
      );
    return wrap(
      hintLevel > 0
        ? "Imagine a velocity arrow pointing right. As the cart slows, that arrow gets shorter. Which direction describes the change from the longer arrow to the shorter one?"
        : "Start with what changes. The cart moves right, but its speed decreases. Does Newton’s second law connect force to velocity, or to acceleration?",
      "motion",
    );
  }
  if (concept === "torque") {
    if (/\b40\b/.test(q))
      return wrap(
        "That fits the perpendicular-force model. You kept r × F unchanged as r became smaller. How would you explain the advantage of a long wrench to a friend?",
        "arm",
      );
    if (/less|same|\b10\b/.test(q))
      return wrap(
        "Move the push point closer to the hinge while keeping force fixed. Watch the torque decrease. To restore the original turning effect, should the force increase or decrease?",
        "arm",
      );
    if (/angle|perpendicular|sin/.test(q))
      return wrap(
        "Only the component perpendicular to the radius contributes to torque: τ = rF sin θ. A push along the radius has no turning effect about that pivot. Try the angle control and compare 90° with 30°.",
        "angle",
      );
    return wrap(
      hintLevel > 0
        ? "Our target torque is 8 N·m. The new moment arm is 0.20 m. Which force multiplied by 0.20 would give 8?"
        : "Look at the distance from the hinge to the push point. If that distance becomes one-quarter as large, how must the force change to keep the same turning effect?",
      "arm",
    );
  }
  if (/\b10\b/.test(q))
    return wrap(
      "Yes. The smaller force acts twice as far from the pivot, so both sides create the same magnitude of torque. What would happen if you moved the smaller force closer?",
      "arm",
    );
  return wrap(
    hintLevel > 0
      ? "The left side produces 20 N × 0.40 m = 8 N·m. What right-side force at 0.80 m would produce the same magnitude?"
      : "Compare force multiplied by distance on each side. A smaller force can balance a larger one when it acts farther from the pivot. Which two products need to match?",
    "arm",
  );
}
