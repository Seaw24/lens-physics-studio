import sharp from "sharp";

// One image per labeled card for the lesson drafter: Bedrock Converse accepts
// at most 20 images per request, so a card's frames are tiled into a single
// sheet in time order, each tile labeled, cited evidence outlined.

/** Claude downsizes images beyond about 1.15 MP or a 1,568 px edge; stay inside both. */
export const SHEET_MAX_PIXELS = 1_150_000;
export const SHEET_MAX_EDGE = 1_568;
const LABEL_HEIGHT = 22;
const GAP = 4;
const BACKGROUND = "#111111";
type Overlay = Parameters<ReturnType<typeof sharp>["composite"]>[0][number];

export interface SheetFrame {
  file: string;
  sourceTimeMs: number | null;
  evidence: boolean;
}

function sheetSize(columns: number, rows: number, tileHeight: number, aspect: number) {
  const tileWidth = Math.max(1, Math.round(aspect * tileHeight));
  return {
    tileWidth,
    width: columns * tileWidth + (columns + 1) * GAP,
    height: rows * (tileHeight + LABEL_HEIGHT) + (rows + 1) * GAP,
  };
}

/** Picks the grid whose tiles are largest while the sheet stays within budget. */
export function layoutContactSheet(count: number, aspect: number) {
  let best = {
    columns: 1,
    rows: count,
    tileWidth: 0,
    tileHeight: 0,
    width: 0,
    height: 0,
  };
  for (let columns = 1; columns <= count; columns++) {
    const rows = Math.ceil(count / columns);
    let low = 8;
    let high = 4_000;
    while (high - low > 1) {
      const middle = Math.floor((low + high) / 2);
      const size = sheetSize(columns, rows, middle, aspect);
      if (
        size.width * size.height <= SHEET_MAX_PIXELS &&
        Math.max(size.width, size.height) <= SHEET_MAX_EDGE
      )
        low = middle;
      else high = middle;
    }
    const size = sheetSize(columns, rows, low, aspect);
    if (size.tileWidth * low > best.tileWidth * best.tileHeight)
      best = { columns, rows, tileHeight: low, ...size };
  }
  return best;
}

export function tileLabel(
  index: number,
  sourceTimeMs: number | null,
  evidence: boolean,
) {
  const time =
    sourceTimeMs === null ? "still" : `${(sourceTimeMs / 1000).toFixed(1)} s`;
  return `${index + 1} · ${time}${evidence ? " · evidence" : ""}`;
}

function labelSvg(text: string, width: number) {
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${LABEL_HEIGHT}"><text x="4" y="16" font-family="Helvetica, Arial, sans-serif" font-size="14" fill="#ffffff">${text}</text></svg>`,
  );
}

function outlineSvg(width: number, height: number) {
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect x="2" y="2" width="${width - 4}" height="${height - 4}" fill="none" stroke="#f5a623" stroke-width="4"/></svg>`,
  );
}

export async function buildContactSheet(frames: SheetFrame[]) {
  if (!frames.length)
    throw new Error("A contact sheet needs at least one frame.");
  const metadata = await sharp(frames[0].file).metadata();
  const aspect =
    metadata.width && metadata.height ? metadata.width / metadata.height : 16 / 9;
  const layout = layoutContactSheet(frames.length, aspect);
  const composites: Overlay[] = [];
  for (const [index, frame] of frames.entries()) {
    const left = GAP + (index % layout.columns) * (layout.tileWidth + GAP);
    const top =
      GAP +
      Math.floor(index / layout.columns) *
        (layout.tileHeight + LABEL_HEIGHT + GAP);
    composites.push({
      input: await sharp(frame.file)
        .resize(layout.tileWidth, layout.tileHeight, {
          fit: "contain",
          background: BACKGROUND,
        })
        .toBuffer(),
      left,
      top,
    });
    if (frame.evidence)
      composites.push({
        input: outlineSvg(layout.tileWidth, layout.tileHeight),
        left,
        top,
      });
    composites.push({
      input: labelSvg(
        tileLabel(index, frame.sourceTimeMs, frame.evidence),
        layout.tileWidth,
      ),
      left,
      top: top + layout.tileHeight,
    });
  }
  const bytes = await sharp({
    create: {
      width: layout.width,
      height: layout.height,
      channels: 3,
      background: BACKGROUND,
    },
  })
    .composite(composites)
    .jpeg({ quality: 80 })
    .toBuffer();
  return {
    bytes,
    width: layout.width,
    height: layout.height,
    columns: layout.columns,
    rows: layout.rows,
  };
}
