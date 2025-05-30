import {
  Field,
  Poseidon,
  verify,
  VerificationKey,
  PrivateKey,
  PublicKey,
} from 'o1js';
import { GenerateActionStackProof } from '../utils/generateFunctions';
import { List } from '../types/common';
import { enableLogs, log } from '../utils/loggers';
import { ActionStackProgram, ActionStackQueue } from '../ActionStack';
import { ACTION_QUEUE_SIZE, VALIDATOR_NUMBER } from '../utils/constants';
import { CalculateActionRoot, GenerateTestActions } from '../utils/testUtils';
import { validatorSet } from './mock';
import { actionListAdd, emptyActionListHash } from '../types/actionHelpers';

describe('Action Stack Proof tests', () => {
  let proofsEnabled = false;
  let vk: VerificationKey;

  //validator variables
  let merkleList: List;
  let activeSet: Array<[PrivateKey, PublicKey]> = [];

  if (process.env.LOGS_ENABLED === '1') {
    enableLogs();
  }

  beforeAll(async () => {
    vk = (
      await ActionStackProgram.compile({
        proofsEnabled,
      })
    ).verificationKey;

    merkleList = List.empty();
    activeSet = validatorSet.slice(0, VALIDATOR_NUMBER);

    for (let i = 0; i < VALIDATOR_NUMBER; i++) {
      const [, publicKey] = activeSet[i];
      merkleList.push(Poseidon.hash(publicKey.toFields()));
    }
  });

  describe('ActionStackQueue Struct', () => {
    it('should create an ActionStackQueue from an array of actions', () => {
      const actions = GenerateTestActions(
        ACTION_QUEUE_SIZE - 5,
        merkleList.hash,
        Field(0)
      );
      const actionQueue = ActionStackQueue.fromArray(actions);
      expect(
        actionQueue.stack
          .slice(0, actions.length)
          .reduce(
            (acc, item, i) =>
              acc &&
              item.actionListHash
                .equals(actionListAdd(emptyActionListHash, actions[i]))
                .toBoolean(),
            true
          )
      ).toBe(true);
      expect(actionQueue.stack.length).toBe(ACTION_QUEUE_SIZE);
      expect(
        actionQueue.stack
          .slice(0, actions.length)
          .reduce((acc, item) => acc || item.isDummy.toBoolean(), false)
      ).toBe(false);
    });

    it('should throew an error if too many actions are provided', () => {
      const tooManyActions = GenerateTestActions(
        ACTION_QUEUE_SIZE + 1,
        merkleList.hash,
        Field(0)
      );
      expect(() => ActionStackQueue.fromArray(tooManyActions)).toThrow(
        `Too many actions, max is ${ACTION_QUEUE_SIZE}`
      );
    });
  });

  describe('ProveIntegrity Method', () => {
    it('should prove integrity of the action stack', async () => {
      const initialActionState = Field(0);
      const actions = GenerateTestActions(
        ACTION_QUEUE_SIZE / 2,
        merkleList.hash,
        initialActionState
      );

      const endActionState = CalculateActionRoot(initialActionState, actions);

      const start = performance.now();
      const { actionStackProof } = await GenerateActionStackProof(
        initialActionState,
        actions
      );
      log(`ProveIntegrity took ${performance.now() - start} ms`);
      const publicOutput = actionStackProof.publicOutput;

      if (proofsEnabled) {
        const isOk = await verify(actionStackProof, vk);
        expect(isOk).toBe(true);
      }
      expect(publicOutput).toEqual(endActionState);
    });

    it('should prove integrity of the big action stack', async () => {
      const initialActionState = Field(0);
      const actions = GenerateTestActions(
        2 * ACTION_QUEUE_SIZE + 123,
        merkleList.hash,
        initialActionState
      );

      const endActionState = CalculateActionRoot(initialActionState, actions);

      const start = performance.now();
      const { actionStackProof } = await GenerateActionStackProof(
        initialActionState,
        actions
      );
      log(`ProveIntegrity took ${performance.now() - start} ms`);
      const publicOutput = actionStackProof.publicOutput;

      if (proofsEnabled) {
        const isOk = await verify(actionStackProof, vk);
        expect(isOk).toBe(true);
      }
      expect(publicOutput).toEqual(endActionState);
    });
  });
});
