import { Field, PublicKey } from 'o1js';
import { ProofGenerators } from '../utils/proofGenerators';
import { VALIDATOR_NUMBER } from '../utils/constants';

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
      it('should throw an error for an array with incorrect length < VALIDATOR_NUMBER', () => {
        const arr = Array(VALIDATOR_NUMBER - 1).fill(Field(0));
        expect(() => ProofGenerators.fromPubkeyArray(arr)).toThrow(
          `Array length must be ${VALIDATOR_NUMBER}, but got ${arr.length}`
        );
      });

      it('should throw an error for an array with incorrect length > VALIDATOR_NUMBER', () => {
        const arr = Array(VALIDATOR_NUMBER + 1).fill(Field(0));
        expect(() => ProofGenerators.fromPubkeyArray(arr)).toThrow(
          `Array length must be ${VALIDATOR_NUMBER}, but got ${arr.length}`
        );
      });

      it('should create a ProofGenerators from a valid array of PublicKeys', () => {
        const arr = Array<PublicKey>(VALIDATOR_NUMBER).fill(PublicKey.empty());
        const publicKeyList = ProofGenerators.fromPubkeyArray(arr);
        expect(publicKeyList.list.length).toBe(VALIDATOR_NUMBER);
        expect(publicKeyList.isEmpty().toBoolean()).toBe(false);
      });

      it('should create a ProofGenerators from a valid array of Fields', () => {
        const arr = Array(VALIDATOR_NUMBER).fill(Field.random());
        const publicKeyList = ProofGenerators.fromFieldArray(arr);
        expect(publicKeyList.list.length).toBe(VALIDATOR_NUMBER);
        expect(publicKeyList.isEmpty().toBoolean()).toBe(false);
      });
    });

    describe('insertAt method', () => {
      it('should insert a value at the specified index', () => {
        const list = ProofGenerators.empty();
        log(
          'list',
          list.list.map((v) => v.toString())
        );
        const index = Field(5);
        const value = Field(1);
        list.insertAt(index, value);
        log(
          'list',
          list.list.map((v) => v.toString())
        );
        expect(list.list[5].equals(value).toBoolean()).toBe(true);
        for (let i = 0; i < VALIDATOR_NUMBER; i++) {
          if (i !== 5) {
            expect(list.list[i].equals(Field(0)).toBoolean()).toBe(true);
          }
        }
      });
    });

    describe('getAt method', () => {
      it('should return the value at the specified index', () => {
        const list = ProofGenerators.empty();
        const index = Field(5);
        const value = Field(1);
        list.insertAt(index, value);
        expect(list.getAt(index).equals(value).toBoolean()).toBe(true);
      });

      it('should return zero for an index that has not been set', () => {
        const list = ProofGenerators.empty();
        const index = Field(10);
        expect(list.getAt(index).equals(Field(0)).toBoolean()).toBe(true);
      });

      it('should return zero for an index out of bounds', () => {
        const list = ProofGenerators.empty();
        const index = Field(VALIDATOR_NUMBER + 1);
        expect(list.getAt(index).equals(Field(0)).toBoolean()).toBe(true);
      });

      it('should return zero for a negative index', () => {
        const list = ProofGenerators.empty();
        const index = Field(-1);
        expect(list.getAt(index).equals(Field(0)).toBoolean()).toBe(true);
      });
    });

    describe('assertEquals method', () => {
      it('should not throw an error for equal lists', () => {
        const list1 = ProofGenerators.fromFieldArray(
          Array(VALIDATOR_NUMBER).fill(Field(1))
        );
        const list2 = ProofGenerators.fromFieldArray(
          Array(VALIDATOR_NUMBER).fill(Field(1))
        );
        expect(() => list1.assertEquals(list2)).not.toThrow();
      });

      it('should throw an error for unequal lists', () => {
        const list1 = ProofGenerators.fromFieldArray(
          Array(VALIDATOR_NUMBER).fill(Field(1))
        );
        const list2 = ProofGenerators.fromFieldArray(
          Array(VALIDATOR_NUMBER).fill(Field(2))
        );
        expect(() => list1.assertEquals(list2)).toThrow();
      });
    });

    describe('appendList method', () => {
      it('should append another ProofGenerators to the current list', () => {
        const list1 = ProofGenerators.fromFieldArray(
          Array(VALIDATOR_NUMBER).fill(Field(1))
        );
        const list2 = ProofGenerators.fromFieldArray(
          Array(VALIDATOR_NUMBER).fill(Field(2))
        );
        const appendedList = list1.appendList(Field(10), list2);
        expect(appendedList.list.length).toBe(VALIDATOR_NUMBER);
        for (let i = 0; i < 10; i++) {
          expect(appendedList.list[i].equals(Field(1)).toBoolean()).toBe(true);
        }
        for (let i = 10; i < VALIDATOR_NUMBER; i++) {
          expect(appendedList.list[i].equals(Field(2)).toBoolean()).toBe(true);
        }

        expect(appendedList.isEmpty().toBoolean()).toBe(false);
      });
    });
  });
});
