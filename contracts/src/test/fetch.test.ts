import { Field } from 'o1js';
import {
  activeNodeEndpoint,
  setMinaNetwork,
  sliceActionHistory,
  withArchiveFailover,
  withNodeFailover,
} from '../utils/fetch.js';
import {
  ARCHIVE_FALLBACKS,
  ENDPOINTS,
  NODE_FALLBACKS,
} from '../utils/constants.js';

// Pins the archive workaround discovered in the 2026-08 lightnet smoke: the
// archive can only slice action history at BLOCK boundaries, so a reduce that
// cuts BATCH_SIZE actions mid-block leaves a fromActionState the archive
// cannot resolve (it returns empty forever, bricking the bridge). fetchActions
// falls back to the full history and cuts it locally with this function.
describe('sliceActionHistory', () => {
  // One entry per action; hash = action state AFTER applying that action.
  const entry = (hash: number) => ({
    actions: [['1', '0', '0', '5', '0', '0', '0']],
    hash: String(hash),
  });
  const history = [101, 102, 103, 104, 105].map(entry);

  it('returns everything after a mid-chain fromActionState', () => {
    expect(sliceActionHistory(history, Field(102))).toEqual(
      [103, 104, 105].map(entry)
    );
  });

  it('returns empty when fromActionState is the chain tip', () => {
    expect(sliceActionHistory(history, Field(105))).toEqual([]);
  });

  it('bounds the slice inclusively at endActionState', () => {
    expect(sliceActionHistory(history, Field(101), Field(104))).toEqual(
      [102, 103, 104].map(entry)
    );
  });

  it('throws when fromActionState is not on a non-empty chain', () => {
    expect(() => sliceActionHistory(history, Field(999))).toThrow(
      /fromActionState 999 is not on the fetched action chain/
    );
  });

  it('throws when endActionState is not on the chain after fromActionState', () => {
    // 102 exists but lies BEFORE the from-cut — must not be silently ignored.
    expect(() => sliceActionHistory(history, Field(103), Field(102))).toThrow(
      /endActionState 102 is not on the fetched action chain/
    );
  });

  it('returns empty for an empty history without throwing', () => {
    expect(sliceActionHistory([], Field(101))).toEqual([]);
  });
});

// Pins the failover contract born in the 2026-08-15 Minascan archive outage:
// primary first, then each ARCHIVE_FALLBACKS entry IN ORDER, one at a time.
// Sequential is the point — o1js's own multi-endpoint support races pairs and
// a primary that fails FAST (Minascan answered 404 immediately) wins the race,
// so its fallbacks are never consulted. The run() stubs never touch the
// network; only the retry orchestration around them is under test.
describe('withArchiveFailover', () => {
  // Hand-rolled spies: pnpm's strict node_modules does not expose
  // @jest/globals, and under the ESM preset the `jest` object is not a
  // runtime global — closures need no import at all.
  const warns: string[] = [];
  const originalWarn = console.warn;
  const originalLog = console.log;

  beforeEach(() => {
    warns.length = 0;
    console.warn = (message?: unknown) => {
      warns.push(String(message));
    };
    // setMinaNetwork logs its endpoint line; keep test output clean.
    console.log = () => {};
  });

  afterEach(() => {
    console.warn = originalWarn;
    console.log = originalLog;
  });

  /** An async stub failing `failures` times before resolving to `result`. */
  function stub(failures: number, result = 'ok') {
    let attempts = 0;
    const run = async () => {
      attempts++;
      if (attempts <= failures)
        throw new Error(`archive down (attempt ${attempts})`);
      return result;
    };
    return { run, attempts: () => attempts };
  }

  it('devnet ships at least one fallback — a single archive is a single point of failure', () => {
    expect(ARCHIVE_FALLBACKS.devnet.length).toBeGreaterThan(0);
  });

  it('returns the first success without consulting any fallback', async () => {
    setMinaNetwork('devnet');
    const { run, attempts } = stub(0, 'primary-result');

    await expect(withArchiveFailover('Test fetch', run)).resolves.toBe(
      'primary-result'
    );
    expect(attempts()).toBe(1);
    expect(warns).toEqual([]);
  });

  it('retries via the fallback when the primary fails, and names it in the warning', async () => {
    setMinaNetwork('devnet');
    const { run, attempts } = stub(1, 'fallback-result');

    await expect(withArchiveFailover('Test fetch', run)).resolves.toBe(
      'fallback-result'
    );
    expect(attempts()).toBe(2);
    expect(warns).toHaveLength(1);
    expect(warns[0]).toContain(ARCHIVE_FALLBACKS.devnet[0]);
  });

  it('propagates the LAST error after exhausting primary and every fallback', async () => {
    setMinaNetwork('devnet');
    const total = 1 + ARCHIVE_FALLBACKS.devnet.length;
    const { run, attempts } = stub(Infinity);

    await expect(withArchiveFailover('Test fetch', run)).rejects.toThrow(
      `archive down (attempt ${total})`
    );
    expect(attempts()).toBe(total);
  });

  it('makes exactly one attempt on lightnet, which has no fallback to walk', async () => {
    setMinaNetwork('lightnet');
    const { run, attempts } = stub(Infinity);

    await expect(withArchiveFailover('Test fetch', run)).rejects.toThrow(
      'archive down (attempt 1)'
    );
    expect(attempts()).toBe(1);
  });
});

// Pins the node-side failover born in the 2026-08-22 Minascan outage: its
// devnet daemon sat in BOOTSTRAP and answered `account(publicKey:)` with null
// for EVERY address, which o1js surfaces as "Could not find account" — the
// prover read the live contract as undeployed. Same sequential contract as
// the archive twin, plus the rule that neither failover may undo the other's
// endpoint choice: both rebuild the one active o1js instance.
describe('withNodeFailover', () => {
  const warns: string[] = [];
  const originalWarn = console.warn;
  const originalLog = console.log;

  beforeEach(() => {
    warns.length = 0;
    console.warn = (message?: unknown) => {
      warns.push(String(message));
    };
    console.log = () => {};
  });

  afterEach(() => {
    console.warn = originalWarn;
    console.log = originalLog;
    // The failover is sticky by design; reset so later tests start on primary.
    setMinaNetwork('devnet');
  });

  /** An async stub failing `failures` times before resolving to `result`. */
  function stub(failures: number, result = 'ok') {
    let attempts = 0;
    const run = async () => {
      attempts++;
      if (attempts <= failures)
        throw new Error(`node down (attempt ${attempts})`);
      return result;
    };
    return { run, attempts: () => attempts };
  }

  it('devnet ships at least one fallback — a single daemon is a single point of failure', () => {
    expect(NODE_FALLBACKS.devnet.length).toBeGreaterThan(0);
  });

  it('returns the first success without consulting any fallback', async () => {
    setMinaNetwork('devnet');
    const { run, attempts } = stub(0, 'primary-result');

    await expect(withNodeFailover('Test read', run)).resolves.toBe(
      'primary-result'
    );
    expect(attempts()).toBe(1);
    expect(warns).toEqual([]);
    expect(activeNodeEndpoint('devnet')).toBe(ENDPOINTS.NODE.devnet);
  });

  it('retries via the fallback, names it, and stays there for later reads', async () => {
    setMinaNetwork('devnet');
    const { run, attempts } = stub(1, 'fallback-result');

    await expect(withNodeFailover('Test read', run)).resolves.toBe(
      'fallback-result'
    );
    expect(attempts()).toBe(2);
    expect(warns).toHaveLength(1);
    expect(warns[0]).toContain(NODE_FALLBACKS.devnet[0]);
    // Sticky: callers that pass an endpoint string (checkZkappTransaction)
    // must not be handed the daemon that just failed.
    expect(activeNodeEndpoint('devnet')).toBe(NODE_FALLBACKS.devnet[0]);
  });

  it('propagates the LAST error after exhausting primary and every fallback', async () => {
    setMinaNetwork('devnet');
    const total = 1 + NODE_FALLBACKS.devnet.length;
    const { run, attempts } = stub(Infinity);

    await expect(withNodeFailover('Test read', run)).rejects.toThrow(
      `node down (attempt ${total})`
    );
    expect(attempts()).toBe(total);
    expect(activeNodeEndpoint('devnet')).toBe(ENDPOINTS.NODE.devnet);
  });

  it('makes exactly one attempt on lightnet, which has no fallback to walk', async () => {
    setMinaNetwork('lightnet');
    const { run, attempts } = stub(Infinity);

    await expect(withNodeFailover('Test read', run)).rejects.toThrow(
      'node down (attempt 1)'
    );
    expect(attempts()).toBe(1);
  });

  it('survives an archive failover — the two share one instance, not one choice', async () => {
    setMinaNetwork('devnet');
    await withNodeFailover('Test read', stub(1).run);
    expect(activeNodeEndpoint('devnet')).toBe(NODE_FALLBACKS.devnet[0]);

    // An archive outage on top of the node outage must not silently drag the
    // node back to the primary that is still down.
    await withArchiveFailover('Test fetch', stub(1).run);

    expect(activeNodeEndpoint('devnet')).toBe(NODE_FALLBACKS.devnet[0]);
  });
});
