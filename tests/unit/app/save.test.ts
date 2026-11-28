import { describe, expect, it } from 'vitest';
import { saveToast, writeLocalFile, type SaveHost } from '../../../src/app/save';

function blob(text = '{"ok":true}'): Blob {
  return new Blob([text], { type: 'application/json' });
}

describe('writeLocalFile', () => {
  it('uses the file picker when the host has it', async () => {
    const written: Blob[] = [];
    const host: SaveHost = {
      showSaveFilePicker: async () => ({
        createWritable: async () => ({
          write: async (data) => {
            written.push(data);
          },
          close: async () => {},
        }),
      }),
      download: () => {
        throw new Error('download should not run');
      },
    };
    await expect(writeLocalFile('part.archilite', blob(), host)).resolves.toBe('picker');
    expect(written).toHaveLength(1);
  });

  it('returns null when the picker is cancelled', async () => {
    const host: SaveHost = {
      showSaveFilePicker: async () => {
        throw new DOMException('cancelled', 'AbortError');
      },
      download: () => {
        throw new Error('download should not run');
      },
    };
    await expect(writeLocalFile('part.archilite', blob(), host)).resolves.toBeNull();
  });

  it('falls through to share when the picker fails for another reason', async () => {
    const host: SaveHost = {
      showSaveFilePicker: async () => {
        throw new Error('not allowed');
      },
      canShare: () => true,
      share: async () => {},
      download: () => {
        throw new Error('download should not run');
      },
    };
    await expect(writeLocalFile('part.archilite', blob(), host)).resolves.toBe('share');
  });

  it('returns null when the share sheet is cancelled', async () => {
    const host: SaveHost = {
      canShare: () => true,
      share: async () => {
        throw new DOMException('cancelled', 'AbortError');
      },
      download: () => {
        throw new Error('download should not run');
      },
    };
    await expect(writeLocalFile('part.archilite', blob(), host)).resolves.toBeNull();
  });

  it('downloads when picker and share are missing', async () => {
    const got: { name: string; blob: Blob }[] = [];
    const host: SaveHost = {
      download: (name, data) => {
        got.push({ name, blob: data });
      },
    };
    await expect(writeLocalFile('part.archilite', blob(), host)).resolves.toBe('download');
    expect(got[0]?.name).toBe('part.archilite');
  });
});

describe('saveToast', () => {
  it('says which channel wrote the file', () => {
    expect(saveToast('a.archilite', 'picker')).toBe('Saved a.archilite to a file you chose.');
    expect(saveToast('a.archilite', 'share')).toBe('Shared a.archilite.');
    expect(saveToast('a.archilite', 'download')).toBe('Saved a.archilite.');
  });
});
