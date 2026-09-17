import { useEffect, useRef, useState } from "react";
import type { EngineView, LabHandle, LabScene } from "./types";
import { flushLabels } from "./draw";

type SceneInput = Omit<
  LabScene,
  "ctx" | "width" | "height" | "clock" | "hover" | "active"
>;

/**
 * Canvas host for an engine view: sizes for device pixels, redraws when the
 * scene changes (or continuously for ambient views), and routes pointer drags
 * on view handles into parameter changes.
 */
export default function LabCanvas({
  view,
  scene,
  label,
  onParams,
  onDragStart,
  onDragEnd,
}: {
  view: EngineView;
  scene: SceneInput;
  label: string;
  onParams: (changes: Record<string, number>) => void;
  onDragStart: () => void;
  onDragEnd: () => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [hover, setHover] = useState<string | null>(null);
  const [active, setActive] = useState<string | null>(null);
  const latest = useRef({ scene, view, size, hover, active });
  latest.current = { scene, view, size, hover, active };
  const frame = useRef<number | null>(null);
  const pendingDrag = useRef<{ handle: LabHandle; x: number; y: number } | null>(null);

  const build = (ctx: CanvasRenderingContext2D): LabScene => ({
    ...latest.current.scene,
    ctx,
    width: latest.current.size.width,
    height: latest.current.size.height,
    clock: performance.now() / 1000,
    hover: latest.current.hover,
    active: latest.current.active,
  });

  const draw = () => {
    const element = canvas.current;
    const { width, height } = latest.current.size;
    if (!element || !width || !height) return;
    const ctx = element.getContext("2d");
    if (!ctx) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    try {
      latest.current.view.draw(build(ctx));
      flushLabels();
    } catch (error) {
      console.error("Lab view failed to draw", error);
    }
  };

  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      const width = Math.round(entry.contentRect.width);
      const height = Math.round(entry.contentRect.height);
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      element.width = Math.max(1, Math.round(width * dpr));
      element.height = Math.max(1, Math.round(height * dpr));
      setSize({ width, height });
    });
    observer.observe(element);
    void document.fonts?.ready.then(() => draw());
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    draw();
  });

  useEffect(() => {
    if (!view.ambient) return;
    let visible = true;
    const element = canvas.current;
    const intersection = element
      ? new IntersectionObserver(([entry]) => (visible = entry.isIntersecting))
      : null;
    if (element) intersection?.observe(element);
    let id = 0;
    const loop = () => {
      if (visible && !document.hidden) draw();
      id = requestAnimationFrame(loop);
    };
    id = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(id);
      intersection?.disconnect();
    };
  }, [view]);

  const handlesAt = (x: number, y: number) => {
    const element = canvas.current;
    const ctx = element?.getContext("2d");
    if (!ctx || !latest.current.view.handles) return null;
    const handles = latest.current.view.handles(build(ctx));
    let best: LabHandle | null = null;
    let bestDistance = Infinity;
    for (const handle of handles) {
      const distance = Math.hypot(handle.x - x, handle.y - y);
      if (distance <= handle.r + 4 && distance < bestDistance) {
        best = handle;
        bestDistance = distance;
      }
    }
    return best;
  };

  const point = (event: React.PointerEvent) => {
    const rect = canvas.current!.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  return (
    <canvas
      ref={canvas}
      className="lab-canvas"
      role="img"
      aria-label={label}
      style={{
        cursor: active ? "grabbing" : hover ? "grab" : "default",
        touchAction: active ? "none" : "pan-y",
      }}
      onPointerDown={(event) => {
        const { x, y } = point(event);
        const handle = handlesAt(x, y);
        if (!handle) return;
        event.preventDefault();
        canvas.current?.setPointerCapture(event.pointerId);
        setActive(handle.id);
        latest.current.active = handle.id;
        onDragStart();
        onParams(handle.drag(x, y));
      }}
      onPointerMove={(event) => {
        const { x, y } = point(event);
        if (latest.current.active) {
          const ctx = canvas.current?.getContext("2d");
          const handle = ctx
            ? latest.current.view
                .handles?.(build(ctx))
                .find((item) => item.id === latest.current.active)
            : null;
          if (!handle) return;
          pendingDrag.current = { handle, x, y };
          if (frame.current === null)
            frame.current = requestAnimationFrame(() => {
              frame.current = null;
              const pending = pendingDrag.current;
              if (pending) onParams(pending.handle.drag(pending.x, pending.y));
            });
          return;
        }
        const handle = handlesAt(x, y);
        const id = handle?.id ?? null;
        if (id !== latest.current.hover) setHover(id);
        if (canvas.current) canvas.current.title = handle?.label ?? "";
      }}
      onPointerUp={(event) => {
        if (!latest.current.active) return;
        canvas.current?.releasePointerCapture(event.pointerId);
        setActive(null);
        latest.current.active = null;
        onDragEnd();
      }}
      onPointerCancel={() => {
        if (!latest.current.active) return;
        setActive(null);
        latest.current.active = null;
        onDragEnd();
      }}
      onPointerLeave={() => {
        if (!latest.current.active && latest.current.hover) setHover(null);
      }}
    />
  );
}
