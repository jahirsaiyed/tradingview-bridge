import type { Dialog, Page } from 'playwright-core';

/**
 * Runs `fn` while auto-accepting the page's own "leave site?" (beforeunload) prompt.
 * Any other dialog type is left alone, and the handler never outlives `fn`.
 */
export async function withBeforeUnloadAccept<T>(
  page: Pick<Page, 'on' | 'off'>,
  fn: () => Promise<T>,
): Promise<T> {
  const handler = (dialog: Dialog): void => {
    if (dialog.type() === 'beforeunload') void dialog.accept();
  };
  page.on('dialog', handler);
  try {
    return await fn();
  } finally {
    page.off('dialog', handler);
  }
}
