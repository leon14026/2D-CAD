/**
 * Errors from reading a drawing that is not ArchiLite's own file: a DXF, a DWG, or a file
 * that looks like one. The message is plain language for the user; `path` names a location
 * in the file when we have one.
 */
export class IoError extends Error {
  constructor(
    message: string,
    readonly path: string = '',
  ) {
    super(message);
    this.name = 'IoError';
  }
}
