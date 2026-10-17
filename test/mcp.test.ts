import { describe, it, expect } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { registerTools } from '../src/mcp.js';
import { TvError } from '../src/result.js';
import type { DriverApi } from '../src/driver/types.js';

function fakeDriver(overrides: Partial<DriverApi> = {}): DriverApi {
  const notUsed = async () => {
    throw new Error('not used in this test');
  };
  return {
    status: async () => ({
      loggedIn: true,
      chartOpen: true,
      symbol: 'FX_IDC:EURUSD',
      interval: '1 hour',
      layout: 'overlay',
      url: 'https://www.tradingview.com/chart/',
      sessionDisconnected: false,
    }),
    openChart: notUsed,
    setScript: async (source) => ({ length: source.length }),
    getScript: notUsed,
    compile: notUsed,
    screenshot: async () => ({ png: Buffer.from('png-bytes') }),
    readPineLogs: notUsed,
    readStrategyStats: notUsed,
    removeScript: notUsed,
    selftest: notUsed,
    ...overrides,
  } as DriverApi;
}

async function connectClient(driver: DriverApi): Promise<Client> {
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  registerTools(server, async () => driver);
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

const textOf = (result: unknown): string =>
  (result as { content: Array<{ type: string; text?: string }> }).content[0]!.text!;

describe('MCP tools', () => {
  it('lists every tool', async () => {
    const client = await connectClient(fakeDriver());
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(
      [
        'tv_compile',
        'tv_get_script',
        'tv_open_chart',
        'tv_read_pine_logs',
        'tv_read_strategy_stats',
        'tv_remove_script',
        'tv_screenshot',
        'tv_selftest',
        'tv_set_script',
        'tv_status',
      ].sort(),
    );
  });

  it('documents the compile result fields and the open_chart reload', async () => {
    const client = await connectClient(fakeDriver());
    const { tools } = await client.listTools();
    const compile = tools.find((t) => t.name === 'tv_compile')!.description!;
    for (const word of ['unchanged', 'runtimeChecked', 'cleanedErrorRows', 'compiled=false']) {
      expect(compile).toContain(word);
    }
    const open = tools.find((t) => t.name === 'tv_open_chart')!.description!;
    expect(open).toContain('Pine Editor');
    expect(open).toContain('unsaved');
  });

  it('wraps successful results with ok:true', async () => {
    const client = await connectClient(fakeDriver());
    const result = await client.callTool({ name: 'tv_status', arguments: {} });
    expect(JSON.parse(textOf(result))).toMatchObject({ ok: true, symbol: 'FX_IDC:EURUSD', layout: 'overlay' });
    expect(result.isError).toBe(false);
  });

  it('passes tool arguments to the driver', async () => {
    const client = await connectClient(fakeDriver());
    const result = await client.callTool({ name: 'tv_set_script', arguments: { source: 'abc' } });
    expect(JSON.parse(textOf(result))).toEqual({ ok: true, length: 3 });
  });

  it('passes overwriteExisting from tv_set_script to the driver', async () => {
    const seen: unknown[] = [];
    const client = await connectClient(
      fakeDriver({
        setScript: async (source, options) => {
          seen.push(options);
          return { length: source.length };
        },
      }),
    );
    await client.callTool({ name: 'tv_set_script', arguments: { source: 'abc', overwriteExisting: true } });
    await client.callTool({ name: 'tv_set_script', arguments: { source: 'abc' } });
    expect(seen[0]).toEqual({ overwriteExisting: true });
    expect((seen[1] as { overwriteExisting?: boolean } | undefined)?.overwriteExisting).toBeUndefined();
  });

  it('passes allowReload (default false) from tv_read_strategy_stats to the driver', async () => {
    const seen: unknown[] = [];
    const client = await connectClient(
      fakeDriver({
        readStrategyStats: async (args) => {
          seen.push(args);
          return {
            keyStats: { totalPnl: null, maxDrawdown: null, profitableTrades: null, profitFactor: null },
            strategyName: 'TV Bridge Smoke',
            matchesOwnedScript: true,
          };
        },
      }),
    );
    await client.callTool({ name: 'tv_read_strategy_stats', arguments: {} });
    await client.callTool({ name: 'tv_read_strategy_stats', arguments: { allowReload: true, includeTrades: true } });
    expect(seen[0]).toEqual({ includeTrades: false, tradeLimit: 50, allowReload: false });
    expect(seen[1]).toEqual({ includeTrades: true, tradeLimit: 50, allowReload: true });
  });

  it('documents the scratch guard, the reload option, truncation and unverified warnings', async () => {
    const client = await connectClient(fakeDriver());
    const { tools } = await client.listTools();
    const describe = (name: string) => tools.find((t) => t.name === name)!.description!;
    expect(describe('tv_set_script')).toContain('overwriteExisting');
    expect(describe('tv_set_script')).toMatch(/owner confirms/);
    const stats = describe('tv_read_strategy_stats');
    for (const word of ['allowReload', 'unsaved chart state', 'tradesTruncated', 'rendered']) expect(stats).toContain(word);
    expect(describe('tv_compile')).toMatch(/unverified/);
    expect(describe('tv_selftest')).toContain('layoutError');
  });

  it('documents report identity, settling, runtime readiness and the session field', async () => {
    const client = await connectClient(fakeDriver());
    const { tools } = await client.listTools();
    const describe = (name: string) => tools.find((t) => t.name === name)!.description!;
    const stats = describe('tv_read_strategy_stats');
    for (const word of ['strategyName', 'matchesOwnedScript', 'FOREIGN_REPORT', 'best-effort']) expect(stats).toContain(word);
    const compile = describe('tv_compile');
    expect(compile).toMatch(/point-in-time/);
    expect(compile).toMatch(/raise its error later/);
    expect(compile).toMatch(/reads the owned row's status again/);
    expect(compile).not.toMatch(/cached result\)/);
    expect(describe('tv_status')).toContain('sessionDisconnected');
  });

  it('converts a TvError into a failure result', async () => {
    const client = await connectClient(
      fakeDriver({
        compile: async () => {
          throw new TvError('TIMEOUT_COMPILE', 'slow', { lastConsole: ['Compiling...'] });
        },
      }),
    );
    const result = await client.callTool({ name: 'tv_compile', arguments: {} });
    expect(result.isError).toBe(true);
    expect(JSON.parse(textOf(result))).toEqual({
      ok: false,
      error: { code: 'TIMEOUT_COMPILE', message: 'slow', details: { lastConsole: ['Compiling...'] } },
    });
  });

  it('rejects tv_open_chart without symbol or interval as INVALID_ARGUMENT', async () => {
    const client = await connectClient(fakeDriver());
    const result = await client.callTool({ name: 'tv_open_chart', arguments: {} });
    expect(result.isError).toBe(true);
    expect(JSON.parse(textOf(result)).error.code).toBe('INVALID_ARGUMENT');
  });

  it('rejects a symbol with a space or slash without calling the driver', async () => {
    let calls = 0;
    const client = await connectClient(
      fakeDriver({
        openChart: async () => {
          calls += 1;
          return { url: 'x' };
        },
      }),
    );
    for (const symbol of ['EUR USD', 'FX/EURUSD']) {
      const outcome = await client
        .callTool({ name: 'tv_open_chart', arguments: { symbol } })
        .then((r) => ({ isError: r.isError, text: textOf(r) }))
        .catch((e: unknown) => ({ isError: true, text: String(e) }));
      expect(outcome.isError).toBe(true);
      expect(outcome.text).toMatch(/invalid|symbol/i);
    }
    expect(calls).toBe(0);
  });

  it('returns the screenshot as a PNG image', async () => {
    const client = await connectClient(fakeDriver());
    const result = await client.callTool({ name: 'tv_screenshot', arguments: {} });
    const content = result.content as Array<{ type: string; data?: string; mimeType?: string }>;
    expect(content[0]).toEqual({
      type: 'image',
      data: Buffer.from('png-bytes').toString('base64'),
      mimeType: 'image/png',
    });
  });

  it('reports driver connection failures from the provider as a failure result', async () => {
    const server = new McpServer({ name: 'test', version: '0.0.0' });
    registerTools(server, async () => {
      throw new TvError('NOT_CONNECTED', 'Chrome is not running');
    });
    const client = new Client({ name: 'test-client', version: '0.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    const result = await client.callTool({ name: 'tv_status', arguments: {} });
    expect(JSON.parse(textOf(result)).error.code).toBe('NOT_CONNECTED');
  });
});
