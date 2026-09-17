import type { EngineId } from "../../../../shared/studio/engines";
import type { EngineView } from "../types";
import { balanceView } from "./balance";
import { buoyancyView } from "./buoyancy";
import { collisionView } from "./collision";
import { pendulumView } from "./pendulum";
import { projectileView } from "./projectile";
import { rotationView } from "./rotation";
import { springView } from "./spring";
import { surfaceView } from "./surface";

export const LAB_VIEWS: Record<EngineId, EngineView> = {
  projectile: projectileView,
  surface: surfaceView,
  rotation: rotationView,
  balance: balanceView,
  pendulum: pendulumView,
  collision: collisionView,
  spring: springView,
  buoyancy: buoyancyView,
};
