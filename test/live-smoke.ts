// Live smoke test. Needs Chrome from scripts/launch-chrome.ps1, logged in to TradingView.
// Sections that write to the editor replace its contents: open a scratch script first and set
// TV_SMOKE_OVERWRITE_EDITOR=1. Usage: npm run smoke -- <section|all>
import type { Page } from 'playwright-core';
import { connect } from '../src/driver/connection.js';
import { createPageLayoutOps } from '../src/driver/pageLayoutOps.js';
import { ensureLayout } from '../src/driver/layout.js';
import { SOURCES } from './fixtures/pine.js';
import { writeAndVerify } from '../src/driver/editor.js';
import { compileAndCollect } from '../src/driver/compile.js';
import { extractScriptTitle } from '../src/parsers/source.js';

type Section = (page: Page) => Promise<void>;

export const state: { owned: string | null } = { owned: null };

export function check(condition: boolean, message: string): void {
  if (!condition) throw new Error(`SMOKE FAIL: ${message}`);
  console.log(`ok - ${message}`);
}

export function requireOverwriteFlag(): void {
  if (process.env.TV_SMOKE_OVERWRITE_EDITOR !== '1') {
    throw new Error('Refusing to overwrite the editor. Open a scratch script and set TV_SMOKE_OVERWRITE_EDITOR=1.');
  }
}

const sections: Record<string, Section> = {
  layout: async (page) => {
    const ops = createPageLayoutOps(page);
    await ensureLayout(ops, 'overlay');
    check((await ops.detect()) === 'overlay', 'overlay layout reached');
    await ensureLayout(ops, 'split');
    check((await ops.detect()) === 'split', 'split layout reached (Pine logs open)');
    await ensureLayout(ops, 'overlay');
    check((await ops.detect()) === 'overlay', 'overlay layout restored');
  },
  compile: async (page) => {
    requireOverwriteFlag();
    await ensureLayout(createPageLayoutOps(page), 'overlay');
    const title = extractScriptTitle(SOURCES.broken);

    await writeAndVerify(page, SOURCES.broken);
    const bad = await compileAndCollect(page, { previousOwned: state.owned, scriptTitle: title });
    check(bad.errors.length >= 1, 'broken source reports a compile error');
    check(bad.errors[0]!.line === 7, `error is on line 7 (got ${bad.errors[0]!.line})`);

    await writeAndVerify(page, SOURCES.valid);
    const good = await compileAndCollect(page, { previousOwned: state.owned, scriptTitle: title });
    check(good.errors.length === 0 && good.action !== null, `valid source compiles (${good.action})`);
    check(!good.runtimeError.present, 'valid source has no runtime error');
    state.owned = good.ownedEntityId;
    check(state.owned !== null, 'bridge owns the legend row it added');

    await writeAndVerify(page, SOURCES.runtimeError);
    const runtime = await compileAndCollect(page, { previousOwned: state.owned, scriptTitle: title });
    check(runtime.errors.length === 0, 'runtime-error source compiles');
    check(
      runtime.runtimeError.present && /^RE\d+$/.test(runtime.runtimeError.code ?? ''),
      `runtime error detected (${runtime.runtimeError.code})`,
    );
    state.owned = runtime.ownedEntityId;
  },
  // SECTIONS-END (add new sections above this line)
};

async function main(): Promise<void> {
  const name = process.argv[2] ?? 'all';
  const { browser, page } = await connect();
  try {
    const names = name === 'all' ? Object.keys(sections) : [name];
    for (const section of names) {
      const run = sections[section];
      if (!run) throw new Error(`Unknown section: ${section}. Known: ${Object.keys(sections).join(', ')}`);
      console.log(`--- ${section}`);
      await run(page);
    }
    console.log('SMOKE PASSED');
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
