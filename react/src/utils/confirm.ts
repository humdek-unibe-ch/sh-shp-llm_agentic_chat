/**
 * Thin wrapper around the jquery-confirm `$.confirm()` dialog, which is
 * loaded globally by the SelfHelp host page (see
 * server/component/style/button/js/button.js for the canonical CMS use
 * site). When the library is unavailable we fall back to the native
 * `window.confirm()` so the feature still works in stripped-down
 * environments (tests, storybook, partial bundles).
 *
 * Always prefer this helper over `window.confirm` so all confirmation
 * dialogs in the agentic chat plugin look and feel the same as the
 * rest of the SelfHelp CMS.
 */

interface JQueryConfirmInstance {
  confirm: (config: {
    title?: string;
    content?: string;
    type?: string;
    icon?: string;
    typeAnimated?: boolean;
    buttons?: Record<string, unknown>;
  }) => unknown;
}

/**
 * Read the global jQuery `$.confirm` plugin exposed by the host CMS.
 * Returns `null` when jquery-confirm has not been loaded.
 */
function readJqueryConfirm(): JQueryConfirmInstance | null {
  if (typeof window === 'undefined') return null;
  const $ = (window as unknown as { jQuery?: JQueryConfirmInstance; $?: JQueryConfirmInstance }).jQuery
    ?? (window as unknown as { jQuery?: JQueryConfirmInstance; $?: JQueryConfirmInstance }).$;
  if (!$ || typeof $.confirm !== 'function') return null;
  return $;
}

export interface ConfirmOptions {
  title?: string;
  message: string;
  /** Confirm button label. Defaults to "Confirm". */
  confirmLabel?: string;
  /** Cancel button label. Defaults to "Cancel". */
  cancelLabel?: string;
  /** jQuery-confirm semantic type ("red", "blue", ...) Defaults to "red". */
  type?: string;
}

/**
 * Show a CMS-style confirmation dialog. Resolves to `true` when the
 * user confirms, `false` on cancel / dismiss.
 */
export function showConfirm(options: ConfirmOptions): Promise<boolean> {
  const {
    title = 'Confirm',
    message,
    confirmLabel = 'Confirm',
    cancelLabel = 'Cancel',
    type = 'red',
  } = options;

  return new Promise<boolean>((resolve) => {
    const $ = readJqueryConfirm();
    if ($) {
      $.confirm({
        title,
        content: message,
        type,
        typeAnimated: true,
        buttons: {
          confirm: {
            text: confirmLabel,
            btnClass: 'btn-danger',
            action: () => resolve(true),
          },
          cancel: {
            text: cancelLabel,
            action: () => resolve(false),
          },
        },
      });
      return;
    }
    // Fallback: native browser confirm.
    resolve(window.confirm(message));
  });
}
