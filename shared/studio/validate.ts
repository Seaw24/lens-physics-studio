import {
  getEngine,
  resolveParams,
  runEngine,
  runExperiment,
  type Engine,
  type Params,
} from "./engines";
import type {
  Anchor,
  Lab,
  Overlay,
  StudioSpec,
  Track,
} from "./schema";

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

/** Lab slider ranges and values, clamped inside the engine's hard limits. */
export function labRanges(engine: Engine<any>, lab: Lab) {
  const ranges: Record<string, { min: number; max: number; value: number }> = {};
  for (const spec of engine.params) {
    const entry = lab.params[spec.key];
    let min = clamp(entry?.min ?? spec.min, spec.min, spec.max);
    let max = clamp(entry?.max ?? spec.max, spec.min, spec.max);
    if (!(max > min)) {
      min = spec.min;
      max = spec.max;
    }
    const value = clamp(entry?.value ?? spec.default, spec.min, spec.max);
    ranges[spec.key] = {
      min: Math.min(min, value),
      max: Math.max(max, value),
      value,
    };
  }
  for (const experiment of lab.experiments)
    for (const [key, value] of Object.entries(experiment.change)) {
      const spec = engine.params.find((item) => item.key === key);
      const range = ranges[key];
      if (!spec || !range) continue;
      const bounded = clamp(value, spec.min, spec.max);
      range.min = Math.min(range.min, bounded);
      range.max = Math.max(range.max, bounded);
    }
  return ranges;
}

export function labBaseParams(engine: Engine<any>, lab: Lab): Params {
  const ranges = labRanges(engine, lab);
  return resolveParams(
    engine,
    Object.fromEntries(Object.entries(ranges).map(([key, r]) => [key, r.value])),
  );
}

/**
 * Repairs that never change meaning: sorted samples, times inside the clip,
 * slider ranges inside hard limits.
 */
export function normalizeStudioSpec(spec: StudioSpec): StudioSpec {
  const duration = spec.clip.durationSeconds;
  const time = (value: number) => clamp(value, 0, duration);
  const overlay = (item: Overlay): Overlay => {
    const from = time(Math.min(item.from, item.to));
    const to = time(Math.max(item.from, item.to));
    const base = { ...item, from, to: Math.max(to, Math.min(duration, from + 0.1)) };
    if (base.type === "ghosts")
      return { ...base, times: [...new Set(base.times.map(time))].sort((a, b) => a - b) };
    return base;
  };
  const engine = getEngine(spec.lab.engine);
  const lab = engine
    ? (() => {
        const ranges = labRanges(engine, spec.lab);
        return {
          ...spec.lab,
          params: Object.fromEntries(
            Object.entries(ranges).map(([key, r]) => [
              key,
              { value: r.value, min: r.min, max: r.max },
            ]),
          ),
        };
      })()
    : spec.lab;
  return {
    ...spec,
    clip: {
      ...spec.clip,
      eventFrom: time(Math.min(spec.clip.eventFrom, spec.clip.eventTo)),
      eventTo: time(Math.max(spec.clip.eventFrom, spec.clip.eventTo)),
    },
    annotations: {
      ...spec.annotations,
      tracks: spec.annotations.tracks.map((track) => ({
        ...track,
        samples: [...track.samples]
          .map((sample) => ({ ...sample, t: time(sample.t) }))
          .sort((a, b) => a.t - b.t),
      })),
      overlays: spec.annotations.overlays.map(overlay),
      chapters: [...spec.annotations.chapters]
        .map((chapter) => ({ ...chapter, t: time(chapter.t) }))
        .sort((a, b) => a.t - b.t),
      freezes: spec.annotations.freezes
        .map((freeze) => ({ ...freeze, t: time(freeze.t) }))
        .sort((a, b) => a.t - b.t),
      slowmo: spec.annotations.slowmo
        .map((segment) => ({
          ...segment,
          from: time(Math.min(segment.from, segment.to)),
          to: time(Math.max(segment.from, segment.to)),
        }))
        .filter((segment) => segment.to - segment.from >= 0.1),
      focusT: time(spec.annotations.focusT),
    },
    revealOverlays: spec.revealOverlays.map(overlay),
    quiz: [...spec.quiz]
      .map((question) =>
        question.type === "scrub"
          ? { ...question, t: time(question.t), answerT: time(question.answerT) }
          : { ...question, t: time(question.t) },
      )
      .sort((a, b) => a.t - b.t),
    lab,
  };
}

function visibleSamplesBetween(track: Track, from: number, to: number) {
  return track.samples.filter(
    (sample) => sample.visible && sample.t >= from - 1e-6 && sample.t <= to + 1e-6,
  );
}

/** Problems with tracks and overlays alone (the annotator's output). */
export function validateAnnotations(
  annotations: StudioSpec["annotations"],
  revealOverlays: Overlay[],
  duration: number,
): string[] {
  const problems: string[] = [];
  const tracks = new Map(annotations.tracks.map((track) => [track.id, track]));
  if (tracks.size !== annotations.tracks.length) problems.push("Track ids must be unique.");
  for (const track of annotations.tracks)
    if (!track.samples.some((sample) => sample.visible))
      problems.push(`Track "${track.id}" is never visible; drop it or mark the frames where it is seen.`);
  const checkAnchor = (anchor: Anchor, where: string) => {
    if ("track" in anchor && !tracks.has(anchor.track))
      problems.push(`${where} anchors to unknown track "${anchor.track}".`);
  };
  const overlays = [...annotations.overlays, ...revealOverlays];
  const overlayIds = new Set<string>();
  for (const overlay of overlays) {
    const where = `Overlay "${overlay.id}"`;
    if (overlayIds.has(overlay.id)) problems.push(`${where} id is used twice.`);
    overlayIds.add(overlay.id);
    if (overlay.from > duration + 0.05)
      problems.push(`${where} starts after the clip ends (${duration.toFixed(2)} s).`);
    switch (overlay.type) {
      case "trail":
      case "halo":
      case "ghosts":
        if (!tracks.has(overlay.track))
          problems.push(`${where} uses unknown track "${overlay.track}".`);
        break;
      case "vector":
        checkAnchor(overlay.anchor, where);
        if (overlay.direction.mode === "toward")
          checkAnchor(overlay.direction.anchor, where);
        if (overlay.direction.mode === "motion" && !("track" in overlay.anchor))
          problems.push(`${where} follows motion but is not anchored to a track.`);
        break;
      case "label":
      case "pivot":
      case "arc":
      case "angle":
        checkAnchor(overlay.anchor, where);
        break;
      case "dimension":
        checkAnchor(overlay.a, where);
        checkAnchor(overlay.b, where);
        break;
    }
    if (overlay.type === "ghosts") {
      const track = tracks.get(overlay.track);
      if (track && visibleSamplesBetween(track, overlay.times[0], overlay.times.at(-1)!).length < 2)
        problems.push(`${where} needs at least two visible samples of "${overlay.track}" between its times.`);
    }
  }
  return problems;
}

/** Problems the agents must fix; an empty list means the studio is usable. */
export function validateStudioSpec(spec: StudioSpec): string[] {
  const duration = spec.clip.durationSeconds;
  const problems = validateAnnotations(spec.annotations, spec.revealOverlays, duration);
  const tracks = new Map(spec.annotations.tracks.map((track) => [track.id, track]));
  const checkAnchor = (anchor: Anchor, where: string) => {
    if ("track" in anchor && !tracks.has(anchor.track))
      problems.push(`${where} anchors to unknown track "${anchor.track}".`);
  };
  const overlayIds = new Set(
    [...spec.annotations.overlays, ...spec.revealOverlays].map((overlay) => overlay.id),
  );
  const questionIds = new Set<string>();
  for (const question of spec.quiz) {
    const where = `Question "${question.id}"`;
    if (questionIds.has(question.id)) problems.push(`${where} id is used twice.`);
    questionIds.add(question.id);
    if (question.t > duration + 0.05)
      problems.push(`${where} pauses after the clip ends (${duration.toFixed(2)} s).`);
    for (const id of question.reveal)
      if (!overlayIds.has(id))
        problems.push(`${where} reveals unknown overlay "${id}".`);
    switch (question.type) {
      case "choice": {
        const correct = question.options.filter((option) => option.correct).length;
        if (correct !== 1)
          problems.push(`${where} must have exactly one correct option (has ${correct}).`);
        if (new Set(question.options.map((o) => o.text.toLowerCase())).size !== question.options.length)
          problems.push(`${where} repeats an option.`);
        break;
      }
      case "vector":
        checkAnchor(question.anchor, where);
        break;
      case "hotspot":
        checkAnchor(question.target, where);
        break;
      case "scrub":
        if (question.answerT > duration + 0.05)
          problems.push(`${where} answer is after the clip ends.`);
        break;
      case "path": {
        const track = tracks.get(question.track);
        if (!track) problems.push(`${where} uses unknown track "${question.track}".`);
        else {
          const ahead = visibleSamplesBetween(track, question.t, question.t + question.horizonS);
          if (ahead.length < 3 || ahead.at(-1)!.t - ahead[0].t < Math.min(0.25, question.horizonS * 0.6))
            problems.push(
              `${where} needs "${question.track}" visible in at least three samples between ${question.t.toFixed(2)} s and ${(question.t + question.horizonS).toFixed(2)} s; pick a time and horizon covered by the track or use another question type.`,
            );
        }
        break;
      }
    }
  }
  problems.push(...validateLab(spec.lab));
  return problems;
}

export function validateLab(lab: Lab): string[] {
  const problems: string[] = [];
  const engine = getEngine(lab.engine);
  if (!engine) return [`Unknown engine "${lab.engine}".`];
  const paramKeys = new Set(engine.params.map((spec) => spec.key));
  const metricKeys = new Set(engine.metrics.map((spec) => spec.key));
  for (const key of Object.keys(lab.params))
    if (!paramKeys.has(key))
      problems.push(`Lab param "${key}" does not exist in engine ${engine.id}.`);
  for (const key of lab.featured)
    if (!paramKeys.has(key))
      problems.push(`Featured param "${key}" does not exist in engine ${engine.id}.`);
  for (const key of lab.readouts)
    if (!metricKeys.has(key))
      problems.push(`Readout "${key}" is not a metric of engine ${engine.id}.`);
  if (problems.length) return problems;
  const base = labBaseParams(engine, lab);
  const baseline = runEngine(engine, base);
  const seen = new Set<string>();
  for (const experiment of lab.experiments) {
    const where = `Experiment "${experiment.id}"`;
    const unknown = Object.keys(experiment.change).filter((key) => !paramKeys.has(key));
    if (unknown.length) {
      problems.push(`${where} changes unknown params: ${unknown.join(", ")}.`);
      continue;
    }
    if (!metricKeys.has(experiment.metric)) {
      problems.push(`${where} measures unknown metric "${experiment.metric}".`);
      continue;
    }
    const result = runExperiment(engine, base, experiment.change, experiment.metric);
    const changedKeys = engine.params
      .map((spec) => spec.key)
      .filter((key) => Math.abs(result.params[key] - base[key]) > 1e-9);
    if (!changedKeys.length) {
      problems.push(`${where} does not change any parameter from the starting values (after clamping to limits).`);
      continue;
    }
    const signature = changedKeys.map((key) => `${key}=${result.params[key]}`).join("&");
    if (seen.has(signature)) problems.push(`${where} repeats another experiment's change.`);
    seen.add(signature);
    const { comparison } = result;
    if (comparison.direction === null)
      problems.push(
        `${where}: metric "${experiment.metric}" is undefined in one of the runs (before ${comparison.before}, after ${comparison.after}); choose a metric that exists in both runs.`,
      );
    else if (comparison.direction !== experiment.expect)
      problems.push(
        `${where} expects "${experiment.expect}" but the simulation gives "${comparison.direction}" (${experiment.metric}: ${fmt(comparison.before)} → ${fmt(comparison.after)}). Fix the expectation and explanation, or change the setup.`,
      );
  }
  if (lab.challenge) {
    const { metric, target, tolerance } = lab.challenge;
    if (!metricKeys.has(metric))
      problems.push(`Challenge measures unknown metric "${metric}".`);
    else {
      const current = baseline.metrics[metric];
      if (current !== null && Math.abs(current - target) <= tolerance)
        problems.push(
          `Challenge is already solved at the starting values (${metric} = ${fmt(current)}); pick a target that needs a change.`,
        );
      else if (!challengeReachable(engine, lab, base))
        problems.push(
          `Challenge target ${metric} = ${target} ± ${tolerance} cannot be reached by moving any single featured slider (${lab.featured.join(", ")}) within its range. Starting value: ${fmt(current)}.`,
        );
    }
  }
  return problems;
}

function challengeReachable(engine: Engine<any>, lab: Lab, base: Params) {
  const challenge = lab.challenge!;
  const ranges = labRanges(engine, lab);
  for (const key of lab.featured) {
    const range = ranges[key];
    if (!range) continue;
    for (let i = 0; i <= 60; i++) {
      const value = range.min + ((range.max - range.min) * i) / 60;
      const params = resolveParams(engine, { ...base, [key]: value });
      const result = runEngine(engine, params).metrics[challenge.metric];
      if (result !== null && Math.abs(result - challenge.target) <= challenge.tolerance)
        return true;
    }
  }
  return false;
}

function fmt(value: number | null | undefined) {
  if (value === null || value === undefined) return "undefined";
  return Math.abs(value) >= 100 ? value.toFixed(1) : value.toPrecision(3);
}
