import { Field, MerkleList, Poseidon } from 'o1js';
import { PulsarAction, PulsarActionBase } from './PulsarAction.js';

export {
  merkleActionsAdd,
  emptyActionListHash,
  actionListAdd,
  ActionList,
  MerkleActions,
};

const encoder = new TextEncoder();

function bytes(s: string) {
  return [...encoder.encode(s)];
}

function prefixToField(prefix: string) {
  const size = (Field as any).sizeInBytes ?? 32;
  if (prefix.length >= size) throw Error('prefix too long');
  return (Field as any).fromBytes(
    bytes(prefix).concat(Array(size - prefix.length).fill(0))
  );
}

function initState(): [Field, Field, Field] {
  return [Field(0), Field(0), Field(0)];
}

function salt(prefix: string) {
  return Poseidon.update(initState(), [prefixToField(prefix)]);
}

function emptyHashWithPrefix(prefix: string) {
  return salt(prefix)[0];
}

const merkleActionsAdd = (hash: Field, actionsListHash: Field): Field => {
  return Poseidon.hashWithPrefix('MinaZkappSeqEvents**', [
    hash,
    actionsListHash,
  ]);
};

const emptyActionListHash = emptyHashWithPrefix('MinaZkappActionsEmpty');

const actionListAdd = (hash: Field, action: PulsarActionBase): Field => {
  return Poseidon.hashWithPrefix('MinaZkappSeqEvents**', [
    hash,
    Poseidon.hashWithPrefix(
      'MinaZkappEvent******',
      PulsarAction.toFields(action)
    ),
  ]);
};

class ActionList extends MerkleList.create(
  PulsarAction,
  actionListAdd,
  emptyHashWithPrefix('MinaZkappActionsEmpty')
) {}

class MerkleActions extends MerkleList.create(
  ActionList.provable,
  (hash, x) => merkleActionsAdd(hash, x.hash),
  emptyHashWithPrefix('MinaZkappActionStateEmptyElt')
) {}
