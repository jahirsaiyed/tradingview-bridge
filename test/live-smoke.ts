// Live smoke test. Needs Chrome from scripts/launch-chrome.ps1, logged in to TradingView.
// Sections that write to the editor replace its contents: open a scratch script first and set
// TV_SMOKE_OVERWRITE_EDITOR=1. Usage: npm run smoke -- <section|all>
import type { Page } from 'playwright-core';
import { connect } from '../src/driver/connection.js';
import { createPageLayoutOps } from '../src/driver/pageLayoutOps.js';
import { ensureLayout } from '../src/driver/layout.js';

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
