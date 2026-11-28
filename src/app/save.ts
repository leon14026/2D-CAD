/**
 * Write a file on this device. Nothing is uploaded. On a phone the picker comes first,
 * then the share sheet, then the same download the desk uses.
 */
export type SaveChannel = 'picker' | 'share' | 'download';

export interface SaveHost {
  readonly showSaveFilePicker?: (options: {
    suggestedName: string;
    types: { description: string; accept: Record<string, string[]> }[];
  }) => Promise<{ createWritable: () => Promise<{ write: (data: Blob) => Promise<void>; close: () => Promise<void> }> }>;
  readonly canShare?: (data: { files: File[] }) => boolean;
  readonly share?: (data: { files: File[]; title: string }) => Promise<void>;
  readonly download: (name: string, blob: Blob) => void;
}

function aborted(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError';
}

/**
 * Writes `blob` as `name`. Returns which channel ran, or null if the user cancelled.
 */
export async function writeLocalFile(name: string, blob: Blob, host: SaveHost): Promise<SaveChannel | null> {
  if (host.showSaveFilePicker) {
    try {
      const handle = await host.showSaveFilePicker({
        suggestedName: name,
        types: [{ description: 'ArchiLite drawing', accept: { 'application/json': ['.archilite'] } }],
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return 'picker';
    } catch (err) {
      if (aborted(err)) return null;
    }
  }
  const file = new File([blob], name, { type: blob.type || 'application/json' });
  if (host.canShare?.({ files: [file] }) && host.share) {
    try {
      await host.share({ files: [file], title: name });
      return 'share';
    } catch (err) {
      if (aborted(err)) return null;
    }
  }
  host.download(name, blob);
  return 'download';
}

export function saveToast(name: string, channel: SaveChannel): string {
  switch (channel) {
    case 'picker':
      return `Saved ${name} to a file you chose.`;
    case 'share':
      return `Shared ${name}.`;
    case 'download':
      return `Saved ${name}.`;
  }
}
