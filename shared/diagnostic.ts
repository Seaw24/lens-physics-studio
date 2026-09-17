export type PhysicsTopicId =
  | "vectors"
  | "kinematics"
  | "forces"
  | "projectile"
  | "energy"
  | "momentum"
  | "circuits"
  | "waves"
  | "optics";

export interface CourseSource {
  id: string;
  name: string;
  content: string;
  addedAt: string;
  sample?: boolean;
  kind?: "text" | "pdf";
  fileSize?: number;
  analysis?: CourseAnalysis;
}

export interface DetectedTopic {
  id: PhysicsTopicId;
  label: string;
  evidenceCount: number;
  prerequisites: string[];
  evidence?: PdfEvidenceReference[];
}

export interface PdfEvidenceReference {
  page: number;
  excerpt: string;
}

export interface CourseMap {
  focus: string;
  summary: string;
  topics: DetectedTopic[];
  language: string;
}

export interface CourseAnalysis {
  title: string;
  map: CourseMap;
  objectives: string[];
  questions: DiagnosticQuestion[];
  provider: "bedrock";
}

export interface DiagnosticQuestion {
  id: string;
  topic: PhysicsTopicId;
  skill: string;
  type: "concept" | "calculation" | "interpretation";
  prompt: string;
  options: string[];
  correctIndex: number;
  explanation: string;
  misconception: string;
}

export type SkillStatus = "strong" | "developing" | "review";

export interface SkillResult {
  topic: PhysicsTopicId;
  label: string;
  correct: number;
  total: number;
  status: SkillStatus;
  note: string;
}

export interface MissedAttempt {
  id: string;
  topic: PhysicsTopicId;
  skill: string;
  prompt: string;
  options: string[];
  chosenIndex: number;
  correctIndex: number;
  explanation: string;
  misconception: string;
}

const topics: Record<
  PhysicsTopicId,
  {
    label: string;
    keywords: RegExp;
    prerequisites: string[];
    summary: string;
  }
> = {
  vectors: {
    label: "Vectors & components",
    keywords:
      /\b(vector|component|magnitude|direction|x[ -]?component|y[ -]?component|sine|cosine)\b/gi,
    prerequisites: ["Basic algebra", "Right-triangle trigonometry"],
    summary: "resolve motion and forces into independent components",
  },
  kinematics: {
    label: "Kinematics",
    keywords:
      /\b(position|displacement|velocity|speed|acceleration|kinematic|motion graph|trajectory)\b/gi,
    prerequisites: ["Reading graphs", "Solving one-variable equations"],
    summary: "connect position, velocity, and acceleration",
  },
  forces: {
    label: "Forces & Newton’s laws",
    keywords:
      /\b(force|newton|gravity|weight|normal force|friction|free[ -]?body|net force|f\s*=\s*ma)\b/gi,
    prerequisites: ["Vectors & components", "Acceleration"],
    summary: "reason from interactions to acceleration",
  },
  projectile: {
    label: "Projectile motion",
    keywords:
      /\b(projectile|launch|flight|apex|parabola|horizontal motion|vertical motion|basketball|air resistance)\b/gi,
    prerequisites: [
      "Vectors & components",
      "Constant acceleration",
      "Basic algebra",
    ],
    summary: "separate horizontal motion from vertical free fall",
  },
  energy: {
    label: "Work & energy",
    keywords:
      /\b(work|energy|kinetic|potential|power|conservation of energy|joule)\b/gi,
    prerequisites: ["Forces", "Algebra with squared quantities"],
    summary: "track energy transfers through a system",
  },
  momentum: {
    label: "Momentum & impulse",
    keywords:
      /\b(momentum|impulse|collision|conservation of momentum|elastic|inelastic)\b/gi,
    prerequisites: ["Vectors", "Newton’s laws"],
    summary: "connect force over time to changes in momentum",
  },
  circuits: {
    label: "Electric circuits",
    keywords:
      /\b(circuit|voltage|current|resistor|ohm|kirchhoff|series circuit|parallel circuit|electric)\b/gi,
    prerequisites: ["Ratios", "Conservation ideas"],
    summary: "reason about voltage, current, and resistance",
  },
  waves: {
    label: "Waves",
    keywords:
      /\b(wave|frequency|wavelength|amplitude|period|sound|interference|standing wave)\b/gi,
    prerequisites: ["Graphs", "Ratios and proportional reasoning"],
    summary: "relate wave speed, frequency, and wavelength",
  },
  optics: {
    label: "Geometric optics",
    keywords:
      /\b(optic|lens|mirror|refraction|reflection|focal|image distance|ray diagram|snell)\b/gi,
    prerequisites: [
      "Similar triangles",
      "Sign conventions",
      "Algebra with reciprocals",
    ],
    summary: "predict images using rays and lens relationships",
  },
};

const questionBank: DiagnosticQuestion[] = [
  {
    id: "projectile-apex-force",
    topic: "projectile",
    skill: "Force at the apex",
    type: "concept",
    prompt:
      "A basketball is at the highest point of its flight. Ignore air resistance. Which statement is correct?",
    options: [
      "Its velocity and acceleration are both zero",
      "Its vertical velocity is zero, but its acceleration is downward",
      "Its acceleration is horizontal",
      "Gravity starts acting again after the ball begins to fall",
    ],
    correctIndex: 1,
    explanation:
      "The vertical velocity is zero for an instant, while gravity continues to produce downward acceleration.",
    misconception:
      "A zero vertical velocity at one instant does not mean zero acceleration or zero net force.",
  },
  {
    id: "projectile-independent-motion",
    topic: "projectile",
    skill: "Independent components",
    type: "interpretation",
    prompt:
      "In an ideal projectile model, what happens to the horizontal velocity while the object is in flight?",
    options: [
      "It steadily decreases because gravity pulls backward",
      "It is zero at the apex",
      "It remains constant",
      "It increases at 9.81 m/s²",
    ],
    correctIndex: 2,
    explanation:
      "Gravity acts vertically, so the ideal model has zero horizontal acceleration and constant horizontal velocity.",
    misconception:
      "Gravity changes the vertical component of velocity, not the horizontal component in this ideal model.",
  },
  {
    id: "vectors-components",
    topic: "vectors",
    skill: "Resolve a launch vector",
    type: "calculation",
    prompt:
      "A ball is launched at speed v₀ and angle θ above horizontal. Which expression gives its initial horizontal velocity?",
    options: ["v₀ sin θ", "v₀ cos θ", "v₀ tan θ", "v₀ − g"],
    correctIndex: 1,
    explanation: "The horizontal component is adjacent to θ, so vₓ = v₀ cos θ.",
    misconception:
      "Sine gives the vertical component when the launch angle is measured from horizontal.",
  },
  {
    id: "kinematics-graph",
    topic: "kinematics",
    skill: "Read velocity from a graph",
    type: "interpretation",
    prompt:
      "On a position-versus-time graph, what does the slope at a particular instant represent?",
    options: ["Acceleration", "Net force", "Velocity", "Distance traveled"],
    correctIndex: 2,
    explanation: "The instantaneous slope of position versus time is velocity.",
    misconception:
      "Acceleration is the slope of a velocity-versus-time graph, not a position-versus-time graph.",
  },
  {
    id: "forces-motion",
    topic: "forces",
    skill: "Separate force from motion",
    type: "concept",
    prompt:
      "A cart moves right while slowing down. What is the direction of its net horizontal force?",
    options: ["Right", "Left", "Zero", "It cannot be determined"],
    correctIndex: 1,
    explanation:
      "Its rightward velocity is decreasing, so acceleration—and therefore net force—points left.",
    misconception:
      "Net force follows the direction of acceleration, which need not match the direction of motion.",
  },
  {
    id: "energy-conservation",
    topic: "energy",
    skill: "Track energy changes",
    type: "concept",
    prompt:
      "A ball rises after launch. Ignoring air resistance, which energy change occurs?",
    options: [
      "Kinetic and gravitational potential energy both increase",
      "Kinetic decreases while gravitational potential increases",
      "Kinetic increases while gravitational potential decreases",
      "Mechanical energy disappears at the apex",
    ],
    correctIndex: 1,
    explanation:
      "As the ball rises, kinetic energy is converted to gravitational potential energy while total mechanical energy stays constant.",
    misconception:
      "Energy changes form; it does not disappear when one velocity component reaches zero.",
  },
  {
    id: "momentum-impulse",
    topic: "momentum",
    skill: "Relate impulse and force",
    type: "concept",
    prompt:
      "For the same change in momentum, increasing the stopping time does what to the average force?",
    options: [
      "Increases it",
      "Decreases it",
      "Leaves it unchanged",
      "Makes it zero",
    ],
    correctIndex: 1,
    explanation:
      "Impulse is FΔt = Δp, so the same momentum change over more time requires a smaller average force.",
    misconception:
      "The total impulse can stay the same even when force and duration change.",
  },
  {
    id: "circuits-series",
    topic: "circuits",
    skill: "Reason about series circuits",
    type: "concept",
    prompt:
      "In a simple series circuit, which quantity is the same through every component?",
    options: ["Voltage", "Current", "Resistance", "Power"],
    correctIndex: 1,
    explanation: "A series path has the same current through each component.",
    misconception:
      "Voltage is divided across series components; current is common to the single path.",
  },
  {
    id: "waves-relationship",
    topic: "waves",
    skill: "Use the wave relationship",
    type: "calculation",
    prompt:
      "A wave’s speed stays constant while its frequency doubles. What happens to its wavelength?",
    options: [
      "It doubles",
      "It halves",
      "It stays the same",
      "It becomes zero",
    ],
    correctIndex: 1,
    explanation: "Because v = fλ, doubling f at constant v halves λ.",
    misconception:
      "Frequency and wavelength are inversely related when wave speed is fixed.",
  },
  {
    id: "optics-converging-lens",
    topic: "optics",
    skill: "Interpret a ray diagram",
    type: "concept",
    prompt:
      "A ray parallel to the principal axis enters an ideal converging lens. Where does it travel afterward?",
    options: [
      "Parallel to the axis",
      "Through the near focal point",
      "Through the far focal point",
      "Back along its incoming path",
    ],
    correctIndex: 2,
    explanation:
      "A parallel incident ray refracts through the focal point on the far side of a converging lens.",
    misconception:
      "For this principal ray, the relevant focal point is on the outgoing side of the lens.",
  },
  {
    id: "vectors-resultant",
    topic: "vectors",
    skill: "Combine perpendicular vectors",
    type: "calculation",
    prompt:
      "Two perpendicular velocity components have equal magnitude v. What is the magnitude of the total velocity?",
    options: ["v", "2v", "√2v", "v²"],
    correctIndex: 2,
    explanation:
      "Perpendicular components form a right triangle, so the magnitude is √(v² + v²) = √2v.",
    misconception:
      "Perpendicular components combine with the Pythagorean theorem, not ordinary addition.",
  },
  {
    id: "kinematics-constant-velocity",
    topic: "kinematics",
    skill: "Connect velocity and acceleration",
    type: "interpretation",
    prompt:
      "A velocity-versus-time graph is a horizontal line above zero. What does that mean?",
    options: [
      "Positive constant velocity and zero acceleration",
      "Positive constant acceleration",
      "The object is at rest",
      "Velocity is increasing linearly",
    ],
    correctIndex: 0,
    explanation:
      "A horizontal velocity graph has zero slope, so acceleration is zero while velocity remains positive.",
    misconception:
      "A nonzero velocity does not require a nonzero acceleration.",
  },
  {
    id: "forces-constant-speed",
    topic: "forces",
    skill: "Reason about balanced forces",
    type: "concept",
    prompt:
      "An elevator moves upward at constant speed. What is true of the net force on it?",
    options: [
      "It points upward",
      "It points downward",
      "It is zero",
      "It increases with height",
    ],
    correctIndex: 2,
    explanation:
      "Constant velocity means zero acceleration, so the upward and downward forces balance.",
    misconception: "Upward motion alone does not imply an upward net force.",
  },
  {
    id: "energy-perpendicular-work",
    topic: "energy",
    skill: "Identify work by a force",
    type: "concept",
    prompt:
      "A force stays perpendicular to an object’s displacement. How much work does that force do?",
    options: [
      "Positive work",
      "Negative work",
      "Zero work",
      "It depends only on mass",
    ],
    correctIndex: 2,
    explanation:
      "Work is W = Fd cos θ. At 90°, cos θ = 0, so that force does no work.",
    misconception:
      "A force can change direction without transferring energy through work.",
  },
  {
    id: "momentum-isolated-system",
    topic: "momentum",
    skill: "Choose a momentum system",
    type: "concept",
    prompt:
      "Two carts collide on a nearly frictionless track. For which system is total momentum conserved during the collision?",
    options: [
      "Either cart by itself",
      "Both carts together",
      "Only the faster cart",
      "Only the cart with greater mass",
    ],
    correctIndex: 1,
    explanation:
      "The collision forces are internal when both carts are included, so the pair’s total momentum is conserved.",
    misconception:
      "Momentum conservation applies to a suitably isolated system, not necessarily to each object inside it.",
  },
  {
    id: "circuits-parallel-voltage",
    topic: "circuits",
    skill: "Reason about parallel branches",
    type: "concept",
    prompt:
      "Two resistors are connected in parallel across a battery. What do they share?",
    options: [
      "The same current in every branch",
      "The same voltage across each branch",
      "The same resistance",
      "Zero electrical power",
    ],
    correctIndex: 1,
    explanation:
      "Parallel branches connect to the same two nodes, so each has the same potential difference.",
    misconception:
      "Current can split between parallel branches; voltage is the shared quantity.",
  },
  {
    id: "waves-speed-calculation",
    topic: "waves",
    skill: "Calculate wavelength",
    type: "calculation",
    prompt:
      "A wave travels at 12 m/s with frequency 3 Hz. What is its wavelength?",
    options: ["0.25 m", "4 m", "9 m", "36 m"],
    correctIndex: 1,
    explanation: "Using v = fλ gives λ = 12 ÷ 3 = 4 m.",
    misconception:
      "Wavelength is wave speed divided by frequency, with units of metres.",
  },
  {
    id: "optics-thin-lens",
    topic: "optics",
    skill: "Use the thin-lens relationship",
    type: "calculation",
    prompt:
      "A converging lens has focal length 10 cm. An object is 30 cm from the lens. What is the image distance?",
    options: ["7.5 cm", "15 cm", "20 cm", "40 cm"],
    correctIndex: 1,
    explanation:
      "From 1/f = 1/dₒ + 1/dᵢ, 1/dᵢ = 1/10 − 1/30 = 1/15, so dᵢ = 15 cm.",
    misconception:
      "The lens equation combines reciprocal distances; the distances are not added directly.",
  },
];

const fallbackOrder: PhysicsTopicId[] = [
  "projectile",
  "vectors",
  "kinematics",
  "forces",
  "energy",
];

function countMatches(text: string, pattern: RegExp) {
  return text.match(pattern)?.length || 0;
}

export function analyzeCourseSources(sources: CourseSource[]): CourseMap {
  const aiMap = [...sources].reverse().find((source) => source.analysis)
    ?.analysis?.map;
  if (aiMap) return aiMap;
  const text = sources.map((source) => source.content).join("\n");
  const specificity: Partial<Record<PhysicsTopicId, number>> = {
    projectile: 2,
    momentum: 1.5,
    circuits: 1.5,
    waves: 1.4,
    optics: 1.5,
  };
  const ranked = (Object.keys(topics) as PhysicsTopicId[])
    .map((id) => ({
      id,
      count: countMatches(text, topics[id].keywords),
    }))
    .filter(({ count }) => count > 0)
    .sort(
      (a, b) =>
        b.count * (specificity[b.id] || 1) - a.count * (specificity[a.id] || 1),
    );
  const selected = (
    ranked.length
      ? ranked
      : fallbackOrder.slice(0, 4).map((id) => ({ id, count: 0 }))
  ).slice(0, 5);
  const detected = selected.map(({ id, count }) => ({
    id,
    label: topics[id].label,
    evidenceCount: count || 1,
    prerequisites: topics[id].prerequisites,
  }));
  const primary = detected[0]?.id || "projectile";
  const next = detected[1]?.id;
  return {
    focus: topics[primary].label,
    summary: next
      ? `The material emphasizes how to ${topics[primary].summary}, supported by ${topics[next].label.toLowerCase()}.`
      : `The material emphasizes how to ${topics[primary].summary}.`,
    topics: detected,
    language: "English",
  };
}

export function buildDiagnostic(
  courseMap: CourseMap,
  limit = 5,
  courseQuestions: DiagnosticQuestion[] = [],
) {
  if (courseQuestions.length >= limit) return courseQuestions.slice(0, limit);
  const related: Record<PhysicsTopicId, PhysicsTopicId[]> = {
    vectors: ["kinematics", "forces", "projectile", "energy"],
    kinematics: ["vectors", "forces", "projectile", "energy"],
    forces: ["vectors", "kinematics", "energy", "projectile"],
    projectile: ["vectors", "kinematics", "forces", "energy"],
    energy: ["forces", "kinematics", "momentum", "vectors"],
    momentum: ["forces", "kinematics", "energy", "vectors"],
    circuits: ["energy", "vectors", "waves", "forces"],
    waves: ["vectors", "energy", "kinematics", "optics"],
    optics: ["waves", "vectors", "energy", "kinematics"],
  };
  const detected = courseMap.topics.map((topic) => topic.id);
  const primary = detected[0] || "projectile";
  const topicSlots: PhysicsTopicId[] = [
    ...detected,
    ...(detected.length === 1 ? [primary] : detected),
    ...related[primary],
    ...fallbackOrder,
  ];
  const used = new Map<PhysicsTopicId, number>();
  const selected: DiagnosticQuestion[] = [];
  for (const topic of topicSlots) {
    if (selected.length >= limit) break;
    const offset = used.get(topic) || 0;
    const next = questionBank.filter((question) => question.topic === topic)[
      offset
    ];
    if (!next) continue;
    used.set(topic, offset + 1);
    selected.push(next);
  }
  return selected;
}

export function gradeDiagnostic(
  questions: DiagnosticQuestion[],
  answers: Record<string, number>,
): SkillResult[] {
  const grouped = new Map<
    PhysicsTopicId,
    { label: string; correct: number; total: number }
  >();
  for (const question of questions) {
    const current = grouped.get(question.topic) || {
      label: topics[question.topic].label,
      correct: 0,
      total: 0,
    };
    current.total += 1;
    if (answers[question.id] === question.correctIndex) current.correct += 1;
    grouped.set(question.topic, current);
  }
  return [...grouped.entries()].map(([topic, score]) => {
    const ratio = score.correct / score.total;
    const status: SkillStatus =
      ratio === 1 ? "strong" : ratio > 0 ? "developing" : "review";
    return {
      topic,
      ...score,
      status,
      note:
        status === "strong"
          ? "Strong evidence in this short check. Keep using it in new contexts."
          : status === "developing"
            ? "The core idea is forming; one targeted example should help stabilize it."
            : questions.find((question) => question.topic === topic)
                ?.misconception ||
              "Review the core model, then try a new example.",
    };
  });
}

export function nextLessonFor(results: SkillResult[]) {
  const target =
    results.find((result) => result.status === "review") ||
    results.find((result) => result.status === "developing") ||
    results[0];
  const topic = target?.topic || "projectile";
  const plans: Record<
    PhysicsTopicId,
    { title: string; why: string; steps: string[] }
  > = {
    vectors: {
      title: "Build motion from components",
      why: "Vector components support the equations used throughout this unit.",
      steps: ["Sketch the vector", "Resolve x and y", "Test it in a launch"],
    },
    kinematics: {
      title: "Read motion before calculating",
      why: "A clear link between graphs, velocity, and acceleration prevents formula guessing.",
      steps: [
        "Compare two motion graphs",
        "Predict the slope",
        "Explain one change",
      ],
    },
    forces: {
      title: "Force follows acceleration",
      why: "Separating motion from net force is the prerequisite for the upcoming model.",
      steps: [
        "Observe the motion",
        "Draw a force model",
        "Defend the direction",
      ],
    },
    projectile: {
      title: "What survives at the top?",
      why: "The apex exposes the most common confusion between velocity and acceleration.",
      steps: [
        "Predict at the apex",
        "Pause the trajectory",
        "Explain what gravity does",
      ],
    },
    energy: {
      title: "Follow the energy, not just the object",
      why: "Tracking transfers gives a second way to reason about the same motion.",
      steps: [
        "Choose the system",
        "Compare two moments",
        "Account for each energy store",
      ],
    },
    momentum: {
      title: "Stretch the stopping time",
      why: "Impulse connects the force model to collisions and catches.",
      steps: [
        "Predict the force",
        "Change the time",
        "Explain the same impulse",
      ],
    },
    circuits: {
      title: "Trace one path through a circuit",
      why: "Current and voltage become clearer when you reason from the circuit topology.",
      steps: ["Mark the paths", "Predict current", "Check the voltage changes"],
    },
    waves: {
      title: "Hold wave speed constant",
      why: "Controlling one variable makes the frequency–wavelength relationship visible.",
      steps: [
        "Predict a change",
        "Adjust frequency",
        "Explain the inverse relationship",
      ],
    },
    optics: {
      title: "Trace three principal rays",
      why: "A consistent ray routine makes image location and type easier to predict.",
      steps: [
        "Choose a principal ray",
        "Apply the lens rule",
        "Locate the image",
      ],
    },
  };
  return { topic, ...plans[topic] };
}

export function missedAttempts(
  questions: DiagnosticQuestion[],
  answers: Record<string, number>,
): MissedAttempt[] {
  return questions
    .filter(
      (question) =>
        Number.isInteger(answers[question.id]) &&
        answers[question.id] !== question.correctIndex,
    )
    .map((question) => ({
      id: question.id,
      topic: question.topic,
      skill: question.skill,
      prompt: question.prompt,
      options: question.options,
      chosenIndex: answers[question.id],
      correctIndex: question.correctIndex,
      explanation: question.explanation,
      misconception: question.misconception,
    }));
}

export function signalsUnderstanding(text: string) {
  return /\b(i understand|i got it|got it|makes sense|i see now|that clicks|ready to check|i'?m ready)\b/i.test(
    text.trim(),
  );
}

export function verificationQuestionsFor(
  missed: MissedAttempt[],
  seenIds: string[],
  limit = 2,
): DiagnosticQuestion[] {
  const seen = new Set(seenIds);
  const selected: DiagnosticQuestion[] = [];
  const take = (candidate: DiagnosticQuestion) => {
    if (
      seen.has(candidate.id) ||
      selected.some((item) => item.id === candidate.id)
    )
      return;
    selected.push(candidate);
  };
  const topicOrder = [
    ...new Set(missed.map((item) => item.topic)),
    ...fallbackOrder,
  ];
  for (const topic of topicOrder) {
    for (const candidate of questionBank.filter(
      (item) => item.topic === topic,
    )) {
      take(candidate);
      if (selected.length >= limit) return selected;
    }
  }
  for (const candidate of questionBank) {
    take(candidate);
    if (selected.length >= limit) break;
  }
  return selected;
}

export function remediationOpening(missed: MissedAttempt[], focus: string) {
  if (!missed.length) {
    return `Your check on ${focus} looked solid. Saying “I understand” is not the test — a new situation is. Tell me which idea you want to lock in, or start the check when you are ready.`;
  }
  const first = missed[0];
  const chosen =
    first.options[first.chosenIndex] ||
    "a different option from the correct one";
  const extra =
    missed.length > 1
      ? ` We can come back to ${missed[1].skill.toLowerCase()} after this.`
      : "";
  return `On ${focus}, the idea that still needs work is ${first.skill.toLowerCase()}. You chose “${chosen}.” ${first.misconception} ${first.explanation}${extra} In your own words, why is the correct picture different?`;
}

export function remediationChatReply(
  message: string,
  missed: MissedAttempt[],
) {
  if (signalsUnderstanding(message)) {
    return "Good — that is a start, not the finish. The next step is a short check in a new situation, not the same question again. Start the check when you want to see whether the idea transfers.";
  }
  const first = missed[0];
  if (!first) {
    return "Pick one idea from this unit and explain it as if you were teaching a classmate. Then we will try it in a new situation.";
  }
  const q = message.toLowerCase();
  if (/why|how|still|confused|don't|dont|wrong/.test(q)) {
    return `${first.explanation} The usual mix-up is this: ${first.misconception} Try saying the distinction in one sentence of your own, without repeating the options.`;
  }
  return `Keep going on ${first.skill.toLowerCase()}. ${first.misconception} If you can restate the correct idea without looking at the original choices, we can check it in a new example.`;
}

export function courseNotebookId(focus: string) {
  const slug = focus
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
  return `course-${slug || "unit"}`;
}

export function courseNotebookRecord({
  focus,
  title,
  missed,
  check,
  checkAnswers,
  mode,
}: {
  focus: string;
  title: string;
  missed: MissedAttempt[];
  check: DiagnosticQuestion[];
  checkAnswers: Record<string, number>;
  mode: string;
}) {
  const correct = check.filter(
    (question) => checkAnswers[question.id] === question.correctIndex,
  ).length;
  const passed = check.length > 0 && correct === check.length;
  const skills = missed.map((item) => item.skill.toLowerCase());
  const id = courseNotebookId(focus);
  return {
    id,
    momentId: id,
    title,
    concept: missed[0]?.topic || "course",
    answer: check.length
      ? `${correct}/${check.length} transferred`
      : "No transfer check yet",
    reflection: passed
      ? skills.length
        ? `After coaching on ${skills.join(" and ")}, the idea held up in a new situation in ${focus}.`
        : `A transfer check in ${focus} held up in a new situation.`
      : skills.length
        ? `Still working through ${skills.join(" and ")} in ${focus}. Transfer check: ${correct}/${check.length}.`
        : `Transfer check in ${focus}: ${correct}/${check.length}. The idea still needs another pass.`,
    completedAt: new Date().toISOString(),
    hints: missed.length,
    mode,
    kind: "course" as const,
  };
}
