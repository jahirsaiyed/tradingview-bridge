import { describe, expect, it, vi } from 'vitest';
import { withBeforeUnloadAccept } from '../../src/driver/dialogs.js';

type Handler = (dialog: unknown) => void;

function fakePage() {
  const handlers: Handler[] = [];
  return {
    handlers,
    on: (_event: 'dialog', handler: Handler) => void handlers.push(handler),
    off: (_event: 'dialog', handler: Handler) => {
      const index = handlers.indexOf(handler);
      if (index >= 0) handlers.splice(index, 1);
    },
    emit: (dialog: unknown) => [...handlers].forEach((handler) => handler(dialog)),
  };
}

function fakeDialog(type: string) {
  return { type: () => type, accept: vi.fn(async () => undefined) };
}

describe('withBeforeUnloadAccept', () => {
  it('accepts a beforeunload dialog raised during the operation', async () => {
    const page = fakePage();
    const dialog = fakeDialog('beforeunload');
    await withBeforeUnloadAccept(page as never, async () => page.emit(dialog));
    expect(dialog.accept).toHaveBeenCalledTimes(1);
  });

  it.each(['alert', 'confirm', 'prompt'])('does not accept a %s dialog', async (type) => {
    const page = fakePage();
    const dialog = fakeDialog(type);
    await withBeforeUnloadAccept(page as never, async () => page.emit(dialog));
    expect(dialog.accept).not.toHaveBeenCalled();
  });

  it('removes the handler after the operation resolves and returns its value', async () => {
    const page = fakePage();
    await expect(withBeforeUnloadAccept(page as never, async () => 7)).resolves.toBe(7);
    expect(page.handlers).toHaveLength(0);
  });

  it('removes the handler and rethrows when the operation rejects', async () => {
    const page = fakePage();
    const failure = new Error('boom');
    await expect(withBeforeUnloadAccept(page as never, async () => Promise.reject(failure))).rejects.toBe(failure);
    expect(page.handlers).toHaveLength(0);
  });

  it('does not accept a dialog emitted after the operation finished', async () => {
    const page = fakePage();
    await withBeforeUnloadAccept(page as never, async () => undefined);
    const dialog = fakeDialog('beforeunload');
    page.emit(dialog);
    expect(dialog.accept).not.toHaveBeenCalled();
  });
});
