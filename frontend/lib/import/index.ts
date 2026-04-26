export { readDocx } from './docx-reader';
export { readPptx } from './pptx-reader';
export { readPdf } from './pdf-reader';
export { readText } from './text-reader';
export type {
  ImportResult,
  ImportedAtom,
  DocumentMetadata,
} from './types';
export { inferCategory, inferCategoryFromFilename } from './types';

import { readDocx } from './docx-reader';
import { readPptx } from './pptx-reader';
import { readPdf } from './pdf-reader';
import { readText } from './text-reader';
import type { ImportResult } from './types';

/**
 * Read any supported document format into structured ImportedAtoms.
 * Dispatches to the format-specific reader based on file extension.
 */
export async function readDocument(
  buffer: Buffer,
  filename: string,
): Promise<ImportResult> {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';

  switch (ext) {
    case 'docx':
    case 'doc':
      return readDocx(buffer, filename);
    case 'pptx':
    case 'ppt':
      return readPptx(buffer, filename);
    case 'pdf':
      return readPdf(buffer, filename);
    case 'txt':
    case 'md':
      return readText(buffer, filename);
    default:
      return {
        atoms: [],
        sourceFilename: filename,
        sourceFormat: 'txt',
        totalChars: 0,
        metadata: {},
      };
  }
}
