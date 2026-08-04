import { Field } from 'o1js';
import { sliceActionHistory } from '../utils/fetch.js';

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
