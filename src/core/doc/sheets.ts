/**
 * Named paper sheets. Geometry, notes, inserts and constraints live on one sheet; the view
 * shows the current sheet. Sheets are named like dimension styles, not ids.
 */
import type { Doc } from './model';
import { SHEET_SIZES, type SheetSize } from './notes';

export const DEFAULT_SHEET_NAME = 'Sheet 1';
export const MAX_SHEETS = 32;

export interface Sheet {
  readonly name: string;
  readonly size: SheetSize;
}

export function defaultSheets(): readonly Sheet[] {
  return [{ name: DEFAULT_SHEET_NAME, size: 'A4' }];
}

/** The sheet an object belongs to: its own name, or the first sheet if it has none. */
export function sheetOf(doc: Pick<Doc, 'sheets'>, obj: { readonly sheet?: string }): string {
  return obj.sheet ?? doc.sheets[0]!.name;
}

export function onCurrentSheet(doc: Doc, obj: { readonly sheet?: string }): boolean {
  return sheetOf(doc, obj) === doc.settings.currentSheet;
}

export function findSheet(doc: Pick<Doc, 'sheets'>, name: string): Sheet | undefined {
  const key = name.trim().toLowerCase();
  return doc.sheets.find((s) => s.name.toLowerCase() === key);
}

export function isSheetSize(v: string): v is SheetSize {
  return (SHEET_SIZES as readonly string[]).includes(v);
}
