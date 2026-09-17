import type {
  Engine,
  Params,
  Simulation,
} from "../../../shared/studio/engines";
import type { Lab } from "../../../shared/studio/schema";

export interface LabScene<S = any> {
  ctx: CanvasRenderingContext2D;
  /** Canvas size in CSS pixels. */
  width: number;
  height: number;
  /** Simulation time being shown, seconds. */
  t: number;
  sim: Simulation<S>;
  state: S;
  params: Params;
  /** The previous run, drawn faintly for comparison. */
  ghost: { sim: Simulation<S>; params: Params; state: S } | null;
  skin: Lab["skin"];
  engine: Engine<S>;
  showVectors: boolean;
  /** Wall-clock seconds, for ambient motion such as water. */
  clock: number;
  /** Id of the handle under the pointer, if any. */
  hover: string | null;
  /** Id of the handle being dragged, if any. */
  active: string | null;
}

export interface LabHandle {
  id: string;
  /** Position in CSS pixels. */
  x: number;
  y: number;
  r: number;
  label: string;
  cursor?: string;
  /** Parameter changes for a pointer position in CSS pixels. */
  drag(px: number, py: number): Params;
}

export interface HudItem {
  label: string;
  value: string;
  color?: string;
}

export interface EngineView<S = any> {
  draw(scene: LabScene<S>): void;
  /** Direct-manipulation handles drawn by the view (for example, drag the push point). */
  handles?(scene: LabScene<S>): LabHandle[];
  /** Series keys to chart, most useful first. */
  charts: string[];
  /** Live values for the corner readout. */
  hud(scene: Pick<LabScene<S>, "t" | "state" | "params" | "sim">): HudItem[];
  /** Keep redrawing while paused (water, idle wobble). */
  ambient?: boolean;
}
