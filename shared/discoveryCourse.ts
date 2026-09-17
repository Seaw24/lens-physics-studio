export const DISCOVERY_COURSE = Object.freeze({
  id: "intro-mechanics-forces-torque" as const,
  version: "2" as const,
  objectives: Object.freeze([
    {
      id: "force-interaction" as const,
      description:
        "Visible contact, push, or pull as context for qualitative force reasoning; contact alone does not establish force magnitude or acceleration.",
    },
    {
      id: "torque-rotation" as const,
      description:
        "Visible rotation or a clearly supported lever/pivot arrangement, with observations kept separate from hypothetical torque.",
    },
    {
      id: "equilibrium-support" as const,
      description:
        "A specific visible support/load arrangement supporting a concrete qualitative explanation.",
    },
    {
      id: "released-object-motion" as const,
      description:
        "Evidence of release and later motion, with idealizations stated and no invented measured trajectory.",
    },
  ]),
});

export type DiscoveryObjectiveId =
  (typeof DISCOVERY_COURSE.objectives)[number]["id"];
