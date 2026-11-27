/**
 * Paper size and drawing bounds for exports. PDF and SVG are 1:1: one millimetre on the
 * drawing is one millimetre on the page.
 */
import { SHEET_MM, onCurrentSheet, type Doc } from '../core/doc';
import { convertLength, type Bounds, type LengthUnit } from '../core/geom';
import { DocIndex } from '../core/spatial';

/** 72 PDF points per inch, 25.4 mm per inch by definition. */
export const PT_PER_INCH = 72;
export const MM_PER_INCH = 25.4;
export const PT_PER_MM = PT_PER_INCH / MM_PER_INCH;

/** How many PDF points one drawing unit occupies at 1:1. */
export function ptPerDrawingUnit(units: LengthUnit): number {
  return convertLength(1, units, 'mm') * PT_PER_MM;
}

const MARGIN_MM = 10;

export interface Paper {
  /** World coordinates of the paper's lower-left corner. */
  readonly originX: number;
  readonly originY: number;
  /** Paper size in drawing units. */
  readonly width: number;
  readonly height: number;
}

/** Bounds of everything on a visible layer, or null if the drawing is empty. */
export function visibleBounds(doc: Doc): Bounds | null {
  return DocIndex.of(doc).visibleExtents();
}

/**
 * The sheet a 1:1 export is drawn on: a title block's ISO sheet if there is one, otherwise
 * the drawing's bounds plus a 10 mm margin.
 */
export function paperFor(doc: Doc): Paper {
  for (const n of doc.notes.values()) {
    if (n.body.kind !== 'titleBlock' || !onCurrentSheet(doc, n)) continue;
    const sheet = SHEET_MM[n.body.size];
    return { originX: n.body.at.x, originY: n.body.at.y, width: sheet.w, height: sheet.h };
  }
  const current = doc.sheets.find((s) => s.name === doc.settings.currentSheet);
  if (current && doc.entities.size === 0 && doc.inserts.size === 0 && doc.notes.size === 0) {
    const mm = SHEET_MM[current.size];
    return { originX: 0, originY: 0, width: convertLength(mm.w, 'mm', doc.settings.units), height: convertLength(mm.h, 'mm', doc.settings.units) };
  }
  const margin = convertLength(MARGIN_MM, 'mm', doc.settings.units);
  const b = visibleBounds(doc);
  if (!b) {
    return {
      originX: -margin,
      originY: -margin,
      width: convertLength(100, 'mm', doc.settings.units),
      height: convertLength(70, 'mm', doc.settings.units),
    };
  }
  return {
    originX: b.minX - margin,
    originY: b.minY - margin,
    width: b.maxX - b.minX + 2 * margin,
    height: b.maxY - b.minY + 2 * margin,
  };
}
