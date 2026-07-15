/**
 * Silence pdfjs-dist's Node canvas-polyfill warnings (imported by pdf-parse).
 *
 * When pdfjs loads in Node it tries to polyfill the browser-only canvas globals
 * `DOMMatrix` / `ImageData` / `Path2D`, and logs
 *   "Cannot polyfill `DOMMatrix`, rendering may be broken."
 * when it can't (no node-canvas installed). Its guard is literally
 * `if (!globalThis.DOMMatrix) { … warn(...) }`.
 *
 * We use pdf-parse ONLY for text extraction (`getText`) — never rendering — so
 * these are pure log noise. Providing minimal no-op stubs makes the guard pass,
 * so pdfjs skips both the polyfill attempt AND the warning. The stubs are never
 * instantiated on the text-extraction path, so behaviour is unchanged.
 *
 * IMPORT THIS BEFORE `pdf-parse` (static: list it first; dynamic: await it first).
 */

const g = globalThis as Record<string, unknown>;
g.DOMMatrix ??= class DOMMatrixStub {};
g.ImageData ??= class ImageDataStub {};
g.Path2D ??= class Path2DStub {};

export {};
