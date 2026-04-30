/**
 * Avatar resolution helpers.
 *
 * The avatar field of a {@link Persona} is intentionally polymorphic:
 *  - an emoji or short label ("🧑", "FT") rendered as plain text,
 *  - a full URL ("https://example.com/foo.png") used as-is,
 *  - an absolute server path ("/server/plugins/.../mediator.svg" or
 *    "/assets/avatars/foo.png") served from the SelfHelp document root,
 *    automatically prefixed with the global `BASE_PATH` so the link
 *    works regardless of the project subfolder,
 *  - a path relative to the document root with no leading slash
 *    ("assets/avatars/foo.png"), normalised the same way.
 *
 * `BASE_PATH` is exposed as a global JS constant by SelfHelp (see
 * BasePage::get_js_constants()). When it is unavailable (e.g. unit
 * tests, storybook), we silently fall back to the original value.
 */

declare const BASE_PATH: string | undefined;

/** Image-extension regex shared between the editor and the chat surfaces. */
const IMAGE_EXTENSION_REGEX = /\.(svg|png|jpe?g|webp|gif|ico|avif)(\?.*)?$/i;

/**
 * Read the global `BASE_PATH` constant exposed by SelfHelp.
 * Returns "" when the constant is missing or empty.
 */
function readBasePath(): string {
  try {
    if (typeof BASE_PATH !== 'undefined' && BASE_PATH) {
      return BASE_PATH;
    }
  } catch {
    // BASE_PATH not declared; ignore.
  }
  if (typeof window !== 'undefined') {
    const fromWindow = (window as unknown as { BASE_PATH?: string }).BASE_PATH;
    if (typeof fromWindow === 'string' && fromWindow) {
      return fromWindow;
    }
  }
  return '';
}

/**
 * @returns `true` when the supplied avatar value looks like an image
 *          URL or path that we should render with `<img>`. Emojis,
 *          short labels and empty strings return `false`.
 */
export function isImageAvatar(avatar: string | null | undefined): boolean {
  if (!avatar) return false;
  const trimmed = avatar.trim();
  if (!trimmed) return false;
  if (/^https?:\/\//i.test(trimmed)) return true;
  if (/^data:image\//i.test(trimmed)) return true;
  if (trimmed.startsWith('/') || trimmed.startsWith('./') || trimmed.startsWith('../')) {
    return IMAGE_EXTENSION_REGEX.test(trimmed);
  }
  // Relative paths like "assets/avatars/foo.png" - require an extension.
  if (/[/\\]/.test(trimmed) && IMAGE_EXTENSION_REGEX.test(trimmed)) return true;
  return false;
}

/**
 * Resolve a stored avatar value into an `<img src>` URL.
 *
 *  - Full URLs and `data:` URIs are returned unchanged.
 *  - Absolute paths are prefixed with `BASE_PATH`.
 *  - Document-root-relative paths (no leading slash) get a leading
 *    slash + `BASE_PATH`.
 *  - Anything that doesn't look like an image (emoji etc.) is
 *    returned as-is so the caller can render it as text.
 *
 * @param avatar  Stored avatar string (may be null/undefined/empty).
 * @returns       URL safe to drop into `<img src>`, or the original
 *                value when no resolution is needed.
 */
export function resolveAvatarUrl(avatar: string | null | undefined): string {
  if (!avatar) return '';
  const trimmed = avatar.trim();
  if (!trimmed) return '';
  if (/^https?:\/\//i.test(trimmed) || /^data:image\//i.test(trimmed)) {
    return trimmed;
  }
  if (!isImageAvatar(trimmed)) {
    return trimmed; // emoji / short label, leave untouched
  }
  const basePath = readBasePath();
  if (!basePath) {
    return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  }
  if (trimmed.startsWith(basePath + '/') || trimmed === basePath) {
    return trimmed; // already prefixed
  }
  if (trimmed.startsWith('/')) {
    return basePath + trimmed;
  }
  return `${basePath}/${trimmed.replace(/^\.\//, '')}`;
}
