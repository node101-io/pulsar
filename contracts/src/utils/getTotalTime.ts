import { AccountUpdate } from 'o1js';

export { getTotalTimeRequired };

export namespace TransactionCost {
  export const PROOF_COST = 10.26 as const;
  export const SIGNED_PAIR_COST = 10.08 as const;
  export const SIGNED_SINGLE_COST = 9.14 as const;
  export const COST_LIMIT = 69.45 as const;
}

function getTotalTimeRequired(accountUpdates: AccountUpdate[]) {
  let eventElements = { events: 0, actions: 0 };

  let authKinds = accountUpdates.map((update) => {
    let { isSigned, isProved, verificationKeyHash } =
      update.body.authorizationKind;
    return {
      isSigned: isSigned.toBoolean(),
      isProved: isProved.toBoolean(),
      verificationKeyHash: verificationKeyHash.toString(),
    };
  });
  // insert entry for the fee payer
  authKinds.unshift({
    isSigned: true,
    isProved: false,
    verificationKeyHash: '',
  });
  let authTypes = filterGroups(authKinds);

  /*
  10.26 * proof + 10.08 * signedPair + 9.14 * signedSingle < 69.45
  */
  let totalTimeRequired =
    TransactionCost.PROOF_COST * authTypes.proof +
    TransactionCost.SIGNED_PAIR_COST * authTypes.signedPair +
    TransactionCost.SIGNED_SINGLE_COST * authTypes.signedSingle;
  // returns totalTimeRequired and additional data used by verifyTransactionLimits
  return { totalTimeRequired, eventElements, authTypes };
}

function filterGroups(xs: AuthorizationKind[]) {
  let pairs = filterPairs(xs);
  xs = pairs.xs;

  let singleCount = 0;
  let proofCount = 0;

  xs.forEach((t) => {
    if (t.isProved) proofCount++;
    else singleCount++;
  });

  return {
    signedPair: pairs.pairs,
    signedSingle: singleCount,
    proof: proofCount,
  };
}

type AuthorizationKind = { isProved: boolean; isSigned: boolean };

const isPair = (a: AuthorizationKind, b: AuthorizationKind) =>
  !a.isProved && !b.isProved;

function filterPairs(xs: AuthorizationKind[]): {
  xs: { isProved: boolean; isSigned: boolean }[];
  pairs: number;
} {
  if (xs.length <= 1) return { xs, pairs: 0 };
  if (isPair(xs[0], xs[1])) {
    let rec = filterPairs(xs.slice(2));
    return { xs: rec.xs, pairs: rec.pairs + 1 };
  } else {
    let rec = filterPairs(xs.slice(1));
    return { xs: [xs[0]].concat(rec.xs), pairs: rec.pairs };
  }
}
