import { Bool, Field, PrivateKey, PublicKey } from 'o1js';
import { ProofGenerators } from '../utils/proofGenerators';
import { AGGREGATE_THRESHOLD } from '../utils/constants';

describe('utils classes and function tests', () => {
  const logsEnabled = false;

  function log(...args: any[]) {
    if (logsEnabled) {
      console.log(...args);
    }
  }

  describe('ProofGenerators class', () => {
    describe('isEmpty method', () => {
      it('should return true for an empty ProofGenerators', () => {
        const emptyList = ProofGenerators.empty();
        expect(emptyList.isEmpty().toBoolean()).toBe(true);
      });

      it('should return false for a non-empty ProofGenerators one filled', () => {
        const list = ProofGenerators.empty();
        list.list[5] = Field(1);
        expect(list.isEmpty().toBoolean()).toBe(false);
      });

      it('should return false for a non-empty ProofGenerators partially filled', () => {
        const list = ProofGenerators.empty();
        list.list[5] = Field(1);
        list.list[10] = Field(1);
        expect(list.isEmpty().toBoolean()).toBe(false);
      });
    });

    describe('fromPubkeyArray method', () => {
      it('should throw an error for an array with incorrect length < AGGREGATE_THRESHOLD', () => {
        const arr = Array(AGGREGATE_THRESHOLD - 1).fill(PublicKey.empty());
        expect(() => ProofGenerators.fromPubkeyArray(arr)).toThrow(
          `Array length must be ${AGGREGATE_THRESHOLD}, but got ${arr.length}`
        );
      });

      it('should throw an error for an array with incorrect length > AGGREGATE_THRESHOLD', () => {
        const arr = Array(AGGREGATE_THRESHOLD + 2).fill(PublicKey.empty());
        expect(() => ProofGenerators.fromPubkeyArray(arr)).toThrow(
          `Array length must be ${AGGREGATE_THRESHOLD}, but got ${arr.length}`
        );
      });

      it('should create a ProofGenerators from a valid array of PublicKeys', () => {
        const arr = Array<PublicKey>(AGGREGATE_THRESHOLD).fill(
          PublicKey.from({
            x: Field(1),
            isOdd: Bool(true),
          })
        );
        const publicKeyList = ProofGenerators.fromPubkeyArray(arr);
        expect(publicKeyList.list.length).toBe(AGGREGATE_THRESHOLD + 1);
        expect(publicKeyList.isEmpty().toBoolean()).toBe(false);
      });

      it('should create a ProofGenerators from a valid array of PubKeys', () => {
        const arr = Array(AGGREGATE_THRESHOLD).fill(
          PrivateKey.random().toPublicKey()
        );
        const publicKeyList = ProofGenerators.fromPubkeyArray(arr);
        expect(publicKeyList.list.length).toBe(AGGREGATE_THRESHOLD + 1);
        expect(publicKeyList.isEmpty().toBoolean()).toBe(false);
      });
    });

    describe('insertAt method', () => {
      it('should insert a pubKey at the specified index', () => {
        const list = ProofGenerators.empty();
        log(
          'list-1',
          list.list.map((v) => v.toString())
        );
        const index = Field(5);
        const pubKey = PublicKey.from({
          x: Field(1),
          isOdd: Bool(true),
        });
        list.insertAt(index, pubKey);
        log(
          'list-2',
          list.list.map((v) => v.toString())
        );
        expect(list.list[5].equals(pubKey.x).toBoolean()).toBe(true);
        for (let i = 0; i < AGGREGATE_THRESHOLD; i++) {
          if (i !== 5) {
            expect(list.list[i].equals(Field(0)).toBoolean()).toBe(true);
          }
        }
        expect(
          list.list[AGGREGATE_THRESHOLD].equals(Field(32)).toBoolean()
        ).toBe(true);
      });
    });

    describe('getPublicKeyAt method', () => {
      it('should return the value at the specified index', () => {
        const list = ProofGenerators.empty();
        const index = Field(5);
        const pubKey = PrivateKey.random().toPublicKey();
        list.insertAt(index, pubKey);
        const pubKeyAt = list.getPublicKeyAt(index);
        log(
          'list-3',
          list.list.map((v) => v.toString())
        );
        log('pubKeyAt', pubKeyAt.toBase58());
        log('pubKeyAt x', pubKeyAt.x.toString());
        log('pubKeyAt isOdd', pubKeyAt.isOdd.toString());
        log('pubKey', pubKey.toBase58());
        log('pubKey x', pubKey.x.toString());
        log('pubKey isOdd', pubKey.isOdd.toString());
        expect(list.getPublicKeyAt(index).equals(pubKey).toBoolean()).toBe(
          true
        );
      });

      it('should return zero for an index that has not been set', () => {
        const list = ProofGenerators.empty();
        const index = Field(10);
        expect(
          list.getPublicKeyAt(index).equals(PublicKey.empty()).toBoolean()
        ).toBe(true);
      });

      it('should return zero for an index out of bounds', () => {
        const list = ProofGenerators.empty();
        const index = Field(AGGREGATE_THRESHOLD + 1);
        expect(
          list.getPublicKeyAt(index).equals(PublicKey.empty()).toBoolean()
        ).toBe(true);
      });

      it('should return zero for a negative index', () => {
        const list = ProofGenerators.empty();
        const index = Field(-1);
        expect(
          list.getPublicKeyAt(index).equals(PublicKey.empty()).toBoolean()
        ).toBe(true);
      });
    });

    describe('assertEquals method', () => {
      it('should not throw an error for equal lists', () => {
        const pubKey = PrivateKey.random().toPublicKey();
        const list1 = ProofGenerators.fromPubkeyArray(
          Array(AGGREGATE_THRESHOLD).fill(pubKey)
        );
        const list2 = ProofGenerators.fromPubkeyArray(
          Array(AGGREGATE_THRESHOLD).fill(pubKey)
        );
        expect(() => list1.assertEquals(list2)).not.toThrow();
      });

      it('should throw an error for unequal lists', () => {
        const list1 = ProofGenerators.fromPubkeyArray(
          Array(AGGREGATE_THRESHOLD).fill(PrivateKey.random().toPublicKey())
        );
        const list2 = ProofGenerators.fromPubkeyArray(
          Array(AGGREGATE_THRESHOLD).fill(PrivateKey.random().toPublicKey())
        );
        expect(() => list1.assertEquals(list2)).toThrow();
      });
    });

    describe('appendList method', () => {
      it('should append another ProofGenerators to the current list', () => {
        const pubKey1 = PrivateKey.random().toPublicKey();
        const pubKey2 = PrivateKey.random().toPublicKey();
        const list1 = ProofGenerators.fromPubkeyArray(
          Array(AGGREGATE_THRESHOLD).fill(pubKey1)
        );
        const list2 = ProofGenerators.fromPubkeyArray(
          Array(AGGREGATE_THRESHOLD).fill(pubKey2)
        );
        const appendedList = list1.appendList(Field(10), list2);
        expect(appendedList.list.length).toBe(AGGREGATE_THRESHOLD + 1);
        for (let i = 0; i < 10; i++) {
          expect(appendedList.list[i].equals(pubKey1.x).toBoolean()).toBe(true);
        }
        for (let i = 10; i < AGGREGATE_THRESHOLD; i++) {
          expect(appendedList.list[i].equals(pubKey2.x).toBoolean()).toBe(true);
        }

        expect(appendedList.isEmpty().toBoolean()).toBe(false);
      });
    });
  });
});
