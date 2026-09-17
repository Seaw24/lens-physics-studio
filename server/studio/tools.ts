import { ENGINE_IDS } from "../../shared/studio/engines/types";
import {
  materials,
  quantities,
  shapes,
  type Anchor,
  type Lab,
  type Overlay,
  type Question,
  type Track,
} from "../../shared/studio/schema";

// Tool schemas the agents answer through, and normalizers that turn their
// percent-and-frame-label answers into the normalized studio contract.

export const ANNOTATION_TOOL = "submit_annotations";
export const LESSON_TOOL = "submit_lesson";

const num = { type: "number" };
const str = { type: "string" };

const anchorJson = {
  type: "object",
  description: 'Either {"track": "<track id>"} or a fixed point {"x": percent, "y": percent}.',
  properties: { track: str, x: num, y: num },
};

const overlayJson = {
  type: "object",
  description:
    "One overlay. Fields used by type — trail: track, style; halo: track, tone (focus|hot); vector: anchor, quantity, direction, magnitude, scale, label; label: anchor, text, tone (neutral|hot|blue); pivot: anchor, label; arc: anchor, radius, startDeg, sweepDeg, label; angle: anchor, fromDeg, toDeg, label; dimension: a, b, label; zone: box [x, y, width, height] in percent, label; ghosts: track, times.",
  properties: {
    id: { type: "string", description: "Unique lowercase id such as vec-weight." },
    type: {
      type: "string",
      enum: ["trail", "halo", "vector", "label", "pivot", "arc", "angle", "dimension", "zone", "ghosts"],
    },
    from: { type: "number", description: "Clip seconds when it appears." },
    to: { type: "number", description: "Clip seconds when it disappears." },
    track: str,
    style: { type: "string", enum: ["comet", "strobe"] },
    tone: { type: "string", enum: ["focus", "hot", "neutral", "blue"] },
    anchor: anchorJson,
    quantity: { type: "string", enum: [...quantities] },
    direction: {
      type: "object",
      properties: {
        mode: { type: "string", enum: ["angle", "motion", "toward"] },
        deg: num,
        anchor: anchorJson,
      },
      required: ["mode"],
    },
    magnitude: { type: "number", description: "0.2–1 relative arrow length." },
    scale: { type: "string", enum: ["fixed", "speed"] },
    label: str,
    text: str,
    radius: { type: "number", description: "Arc radius as a fraction of frame width (0.03–0.3)." },
    startDeg: num,
    sweepDeg: num,
    fromDeg: num,
    toDeg: num,
    a: anchorJson,
    b: anchorJson,
    box: { type: "array", items: num, minItems: 4, maxItems: 4 },
    times: { type: "array", items: num },
  },
  required: ["id", "type", "from", "to"],
};

export function annotationToolConfig(frameLabels: string[]) {
  return {
    tools: [
      {
        toolSpec: {
          name: ANNOTATION_TOOL,
          description: "Submit tracks, overlays, chapters, freezes and slow motion for the clip.",
          inputSchema: {
            json: {
              type: "object",
              properties: {
                analysis: str,
                tracks: {
                  type: "array",
                  maxItems: 4,
                  items: {
                    type: "object",
                    properties: {
                      id: { type: "string", description: "Lowercase id such as can or hinge." },
                      label: str,
                      role: { type: "string", enum: ["body", "agent", "pivot", "contact", "support", "marker"] },
                      keyframes: {
                        type: "array",
                        items: {
                          type: "object",
                          properties: {
                            frame: { type: "string", enum: frameLabels },
                            box: {
                              type: "array",
                              items: num,
                              minItems: 4,
                              maxItems: 4,
                              description: "[x0, y0, x1, y1] in percent of the frame.",
                            },
                            visible: { type: "boolean" },
                          },
                          required: ["frame", "visible"],
                        },
                      },
                    },
                    required: ["id", "label", "role", "keyframes"],
                  },
                },
                overlays: { type: "array", maxItems: 16, items: overlayJson },
                chapters: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: { t: num, title: str, caption: str },
                    required: ["t", "title", "caption"],
                  },
                },
                freezes: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: { t: num, holdSeconds: num, caption: str },
                    required: ["t", "holdSeconds", "caption"],
                  },
                },
                slowmo: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: { from: num, to: num, rate: num },
                    required: ["from", "to", "rate"],
                  },
                },
                focusT: num,
              },
              required: ["analysis", "tracks", "overlays", "chapters", "freezes", "slowmo", "focusT"],
            },
          },
        },
      },
    ],
    toolChoice: { tool: { name: ANNOTATION_TOOL } },
  };
}

export function lessonToolConfig(trackIds: string[]) {
  const trackAnchor = {
    ...anchorJson,
    description: `Either {"track": one of ${trackIds.join(", ") || "(none)"}} or {"x": percent, "y": percent}.`,
  };
  return {
    tools: [
      {
        toolSpec: {
          name: LESSON_TOOL,
          description: "Submit the headline, the in-video quiz and the physics lab.",
          inputSchema: {
            json: {
              type: "object",
              properties: {
                analysis: str,
                headline: {
                  type: "object",
                  properties: {
                    title: str,
                    subtitle: str,
                    concept: str,
                    summary: str,
                    equation: { type: ["string", "null"] },
                    keyIdeas: { type: "array", items: str },
                  },
                  required: ["title", "subtitle", "concept", "summary", "equation", "keyIdeas"],
                },
                quiz: {
                  type: "array",
                  minItems: 3,
                  maxItems: 5,
                  items: {
                    type: "object",
                    description:
                      "Fields by type — choice: options; vector: anchor, quantity, answerDeg, toleranceDeg; hotspot: target, radius; scrub: answerT, toleranceS; path: track, horizonS.",
                    properties: {
                      id: str,
                      type: { type: "string", enum: ["choice", "vector", "hotspot", "scrub", "path"] },
                      t: num,
                      kicker: str,
                      prompt: str,
                      hint: str,
                      explanation: str,
                      reveal: { type: "array", items: str },
                      options: {
                        type: "array",
                        items: {
                          type: "object",
                          properties: { text: str, correct: { type: "boolean" }, feedback: str },
                          required: ["text", "correct", "feedback"],
                        },
                      },
                      anchor: trackAnchor,
                      quantity: { type: "string", enum: [...quantities] },
                      answerDeg: num,
                      toleranceDeg: num,
                      target: trackAnchor,
                      radius: num,
                      answerT: num,
                      toleranceS: num,
                      track: str,
                      horizonS: num,
                    },
                    required: ["id", "type", "t", "kicker", "prompt", "hint", "explanation", "reveal"],
                  },
                },
                revealOverlays: { type: "array", maxItems: 8, items: overlayJson },
                lab: {
                  type: "object",
                  properties: {
                    engine: { type: "string", enum: [...ENGINE_IDS] },
                    title: str,
                    goal: str,
                    skin: {
                      type: "object",
                      properties: {
                        body: {
                          type: "object",
                          properties: { name: str, shape: { type: "string", enum: [...shapes] }, color: str },
                          required: ["name", "shape", "color"],
                        },
                        other: {
                          type: ["object", "null"],
                          properties: { name: str, shape: { type: "string", enum: [...shapes] }, color: str },
                        },
                        surface: {
                          type: ["object", "null"],
                          properties: { name: str, material: { type: "string", enum: [...materials] } },
                        },
                        agent: { type: ["string", "null"] },
                      },
                      required: ["body", "other", "surface", "agent"],
                    },
                    params: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: { key: str, value: num, min: num, max: num },
                        required: ["key", "value"],
                      },
                    },
                    featured: { type: "array", items: str },
                    readouts: { type: "array", items: str },
                    experiments: {
                      type: "array",
                      minItems: 2,
                      maxItems: 4,
                      items: {
                        type: "object",
                        properties: {
                          id: str,
                          title: str,
                          question: str,
                          change: {
                            type: "array",
                            items: {
                              type: "object",
                              properties: { key: str, value: num },
                              required: ["key", "value"],
                            },
                          },
                          metric: str,
                          expect: { type: "string", enum: ["increase", "decrease", "same"] },
                          explanation: str,
                        },
                        required: ["id", "title", "question", "change", "metric", "expect", "explanation"],
                      },
                    },
                    challenge: {
                      type: ["object", "null"],
                      properties: {
                        title: str,
                        prompt: str,
                        metric: str,
                        target: num,
                        tolerance: num,
                        hint: str,
                      },
                    },
                    takeaway: str,
                  },
                  required: ["engine", "title", "goal", "skin", "params", "featured", "readouts", "experiments", "challenge", "takeaway"],
                },
              },
              required: ["analysis", "headline", "quiz", "revealOverlays", "lab"],
            },
          },
        },
      },
    ],
    toolChoice: { tool: { name: LESSON_TOOL } },
  };
}

const parseLoose = (value: unknown) => (typeof value === "string" ? JSON.parse(value) : value);
const list = (value: unknown): any[] => {
  const parsed = parseLoose(value);
  return Array.isArray(parsed) ? parsed : [];
};
const pct = (value: unknown) => Math.min(1, Math.max(0, Number(value) / 100));
const clampNumber = (value: unknown, min: number, max: number, fallback: number) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
};

/** Shortens model text to a whole sentence or word, never mid-word. */
export function fitText(value: unknown, max: number) {
  const text = String(value ?? "").trim().replace(/\s+/g, " ");
  if (text.length <= max) return text;
  const head = text.slice(0, max);
  const sentence = Math.max(head.lastIndexOf(". "), head.lastIndexOf("! "), head.lastIndexOf("? "));
  if (sentence >= max * 0.5) return head.slice(0, sentence + 1);
  const space = text.slice(0, max - 1).lastIndexOf(" ");
  return `${(space > 0 ? text.slice(0, space) : text.slice(0, max - 1)).replace(/[\s,;:—-]+$/, "")}…`;
}

export function slug(value: unknown, fallback: string) {
  const text = String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^[-_]+|-+$/g, "")
    .slice(0, 40);
  return text || fallback;
}

function anchor(value: any): Anchor {
  if (value && typeof value.track === "string" && value.track.trim())
    return { track: slug(value.track, "track") };
  return { x: pct(value?.x ?? 50), y: pct(value?.y ?? 50) };
}

/** Maps frame labels to clip times and percent boxes to normalized centers and sizes. */
export function normalizeTracks(input: unknown, frameTimes: Map<string, number>): Track[] {
  return list(input).map((track: any, index) => {
    const keyed = new Map<number, Track["samples"][number]>();
    let lastVisible: { x: number; y: number; w: number; h: number } | null = null;
    const keyframes = list(track?.keyframes)
      .filter((keyframe: any) => frameTimes.has(keyframe?.frame))
      .sort((a: any, b: any) => frameTimes.get(a.frame)! - frameTimes.get(b.frame)!);
    for (const keyframe of keyframes) {
      const t = frameTimes.get(keyframe.frame)!;
      const box = Array.isArray(keyframe.box) && keyframe.box.length === 4 ? keyframe.box.map(Number) : null;
      const visible = Boolean(keyframe.visible) && box !== null && box.every(Number.isFinite);
      if (visible) {
        const [x0, y0, x1, y1] = box!;
        const geometry = {
          x: pct((x0 + x1) / 2),
          y: pct((y0 + y1) / 2),
          w: Math.max(0.004, Math.min(1, Math.abs(x1 - x0) / 100)),
          h: Math.max(0.004, Math.min(1, Math.abs(y1 - y0) / 100)),
        };
        lastVisible = geometry;
        keyed.set(t, { t, ...geometry, visible: true });
      } else keyed.set(t, { t, ...(lastVisible ?? { x: 0.5, y: 0.5, w: 0.01, h: 0.01 }), visible: false });
    }
    return {
      id: slug(track?.id, `track-${index + 1}`),
      label: String(track?.label ?? `Object ${index + 1}`).slice(0, 40) || `Object ${index + 1}`,
      role: ["body", "agent", "pivot", "contact", "support", "marker"].includes(track?.role) ? track.role : "body",
      samples: [...keyed.values()].sort((a, b) => a.t - b.t),
    };
  });
}

export function normalizeOverlay(item: any, index: number): Overlay {
  const base = {
    id: slug(item?.id, `overlay-${index + 1}`),
    from: Number(item?.from) || 0,
    to: Number(item?.to) || 0,
  };
  const raw = String(item?.label ?? item?.text ?? "").trim();
  const label = fitText(raw, 48);
  switch (item?.type) {
    case "trail":
      return { ...base, type: "trail", track: slug(item.track, "track"), style: item.style === "strobe" ? "strobe" : "comet" };
    case "halo":
      return { ...base, type: "halo", track: slug(item.track, "track"), tone: item.tone === "hot" ? "hot" : "focus" };
    case "vector": {
      const direction = parseLoose(item.direction) ?? {};
      return {
        ...base,
        type: "vector",
        anchor: anchor(parseLoose(item.anchor)),
        quantity: (quantities as readonly string[]).includes(item.quantity) ? item.quantity : "force",
        direction:
          direction.mode === "motion"
            ? { mode: "motion" }
            : direction.mode === "toward"
              ? { mode: "toward", anchor: anchor(direction.anchor) }
              : { mode: "angle", deg: clampNumber(direction.deg, -720, 720, 270) },
        magnitude: clampNumber(item.magnitude, 0.15, 1, 0.6),
        scale: item.scale === "speed" ? "speed" : "fixed",
        label: fitText(raw, 18) || "F",
      };
    }
    case "label":
      return {
        ...base,
        type: "label",
        anchor: anchor(parseLoose(item.anchor)),
        text: label || "Look here",
        tone: item.tone === "hot" ? "hot" : item.tone === "blue" ? "blue" : "neutral",
      };
    case "pivot":
      return { ...base, type: "pivot", anchor: anchor(parseLoose(item.anchor)), label: fitText(raw, 24) || "pivot" };
    case "arc": {
      const radius = Number(item.radius);
      return {
        ...base,
        type: "arc",
        anchor: anchor(parseLoose(item.anchor)),
        radius: clampNumber(radius > 1 ? radius / 100 : radius, 0.02, 0.45, 0.1),
        startDeg: clampNumber(item.startDeg, -720, 720, 0),
        sweepDeg: clampNumber(item.sweepDeg, -340, 340, 90),
        label: fitText(raw, 18) || "τ",
      };
    }
    case "angle":
      return {
        ...base,
        type: "angle",
        anchor: anchor(parseLoose(item.anchor)),
        fromDeg: clampNumber(item.fromDeg, -720, 720, 0),
        toDeg: clampNumber(item.toDeg, -720, 720, 45),
        label: fitText(raw, 18) || "θ",
      };
    case "dimension":
      return {
        ...base,
        type: "dimension",
        a: anchor(parseLoose(item.a)),
        b: anchor(parseLoose(item.b)),
        label: fitText(raw, 28) || "distance",
      };
    case "zone": {
      const box = list(item.box).map(Number);
      return {
        ...base,
        type: "zone",
        box: {
          x: pct(box[0] ?? 0),
          y: pct(box[1] ?? 0),
          w: Math.min(1, Math.max(0.01, (box[2] ?? 10) / 100)),
          h: Math.min(1, Math.max(0.01, (box[3] ?? 10) / 100)),
        },
        label: fitText(raw, 28) || "contact",
      };
    }
    case "ghosts":
    default:
      return {
        ...base,
        type: "ghosts",
        track: slug(item?.track, "track"),
        times: list(item?.times).map(Number).filter(Number.isFinite).slice(0, 8),
      };
  }
}

export function normalizeQuestion(item: any, index: number): Question {
  const base = {
    id: slug(item?.id, `q${index + 1}`),
    t: Number(item?.t) || 0,
    kicker: String(item?.kicker ?? "").trim(),
    prompt: String(item?.prompt ?? "").trim(),
    hint: String(item?.hint ?? "").trim(),
    explanation: String(item?.explanation ?? "").trim(),
    reveal: list(item?.reveal).map((id) => slug(id, "overlay")).slice(0, 6),
  };
  switch (item?.type) {
    case "vector":
      return {
        ...base,
        type: "vector",
        anchor: anchor(parseLoose(item.anchor)),
        quantity: (quantities as readonly string[]).includes(item.quantity) ? item.quantity : "force",
        answerDeg: clampNumber(item.answerDeg, -720, 720, 270),
        toleranceDeg: clampNumber(item.toleranceDeg, 10, 60, 35),
      };
    case "hotspot": {
      const radius = Number(item.radius);
      return {
        ...base,
        type: "hotspot",
        target: anchor(parseLoose(item.target)),
        radius: clampNumber(radius > 1 ? radius / 100 : radius, 0.025, 0.22, 0.08),
      };
    }
    case "scrub":
      return {
        ...base,
        type: "scrub",
        answerT: Number(item.answerT) || 0,
        toleranceS: clampNumber(item.toleranceS, 0.08, 1.2, 0.3),
      };
    case "path":
      return {
        ...base,
        type: "path",
        track: slug(item.track, "track"),
        horizonS: clampNumber(item.horizonS, 0.25, 4, 0.8),
      };
    case "choice":
    default:
      return {
        ...base,
        type: "choice",
        options: list(item?.options).map((option: any) => ({
          text: String(option?.text ?? "").trim(),
          correct: option?.correct === true,
          feedback: String(option?.feedback ?? "").trim(),
        })),
      };
  }
}

const SHAPE_COLORS: Record<string, string> = {
  ball: "#d9772b",
  can: "#c8102e",
  bottle: "#5fb3e6",
  door: "#9a6b43",
  boat: "#f5c518",
  person: "#4f7cff",
};

function hexColor(value: unknown, shape: string) {
  const text = String(value ?? "").trim();
  if (/^#[0-9a-fA-F]{6}$/.test(text)) return text;
  if (/^#[0-9a-fA-F]{3}$/.test(text)) return `#${text.slice(1).replace(/(.)/g, "$1$1")}`;
  return SHAPE_COLORS[shape] ?? "#7c9bff";
}

function skinItem(value: any) {
  if (!value || typeof value !== "object") return null;
  const shape = (shapes as readonly string[]).includes(value.shape) ? value.shape : "box";
  return {
    name: String(value.name ?? shape).trim().slice(0, 28) || shape,
    shape,
    color: hexColor(value.color, shape),
  };
}

export function normalizeLab(input: any): Lab {
  const lab = parseLoose(input) ?? {};
  const skin = parseLoose(lab.skin) ?? {};
  const surface = parseLoose(skin.surface);
  const params: Lab["params"] = {};
  for (const entry of list(lab.params)) {
    if (typeof entry?.key !== "string") continue;
    const value = Number(entry.value);
    if (!Number.isFinite(value)) continue;
    params[entry.key] = {
      value,
      min: Number.isFinite(Number(entry.min)) && entry.min !== null ? Number(entry.min) : null,
      max: Number.isFinite(Number(entry.max)) && entry.max !== null ? Number(entry.max) : null,
    };
  }
  const challenge = parseLoose(lab.challenge);
  return {
    engine: lab.engine,
    title: String(lab.title ?? "").trim(),
    goal: String(lab.goal ?? "").trim(),
    skin: {
      body: skinItem(parseLoose(skin.body)) ?? { name: "object", shape: "box", color: "#7c9bff" },
      other: skinItem(parseLoose(skin.other)),
      surface:
        surface && typeof surface === "object"
          ? {
              name: String(surface.name ?? "surface").trim().slice(0, 28) || "surface",
              material: (materials as readonly string[]).includes(surface.material) ? surface.material : "wood",
            }
          : null,
      agent: typeof skin.agent === "string" && skin.agent.trim() ? skin.agent.trim().slice(0, 28) : null,
    } as Lab["skin"],
    params,
    featured: list(lab.featured).map(String).slice(0, 5),
    readouts: list(lab.readouts).map(String).slice(0, 4),
    experiments: list(lab.experiments).map((experiment: any, index) => ({
      id: slug(experiment?.id, `experiment-${index + 1}`),
      title: String(experiment?.title ?? "").trim(),
      question: String(experiment?.question ?? "").trim(),
      change: Object.fromEntries(
        list(experiment?.change)
          .filter((entry: any) => typeof entry?.key === "string" && Number.isFinite(Number(entry.value)))
          .map((entry: any) => [entry.key, Number(entry.value)]),
      ),
      metric: String(experiment?.metric ?? ""),
      expect: experiment?.expect,
      explanation: String(experiment?.explanation ?? "").trim(),
    })),
    challenge:
      challenge && typeof challenge === "object"
        ? {
            title: String(challenge.title ?? "").trim(),
            prompt: String(challenge.prompt ?? "").trim(),
            metric: String(challenge.metric ?? ""),
            target: Number(challenge.target),
            tolerance: Math.abs(Number(challenge.tolerance)),
            hint: String(challenge.hint ?? "").trim(),
          }
        : null,
    takeaway: String(lab.takeaway ?? "").trim(),
  };
}
