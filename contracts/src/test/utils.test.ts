import { PublicKeyList } from '../utils';

describe('utils classes and function tests', () => {
  const logsEnabled = true;

  function log(...args: any[]) {
    if (logsEnabled) {
      console.log(...args);
    }
  }

  test('PublicKeyList empty', () => {
    const list = PublicKeyList.empty();
    expect(list.isEmpty().toBoolean()).toBe(true);
  });
});
