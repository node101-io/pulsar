import {
  AccountUpdate,
  fetchAccount,
  Mina,
  PrivateKey,
  PublicKey,
  UInt64,
} from 'o1js';
import { SettlementContract } from '../SettlementContract.js';
import { List } from '../types/common.js';
import { mockValidatorList } from '../test/mock.js';

export const DeployScripts = {
  fetchAccounts,
  waitTransactionAndFetchAccount,
  deploySettlementContract,
  deployAndInitializeContract,
  sendMina,
};

async function sendMina(
  senderKey: PrivateKey,
  receiverKey: PublicKey,
  amount: UInt64,
  fee: number = 1e9
) {
  const tx = await Mina.transaction(
    { sender: senderKey.toPublicKey(), fee },
    async () => {
      const senderAccount = AccountUpdate.createSigned(senderKey.toPublicKey());
      AccountUpdate.fundNewAccount(senderKey.toPublicKey());
      senderAccount.send({ to: receiverKey, amount });
    }
  );

  await waitTransactionAndFetchAccount(tx, [senderKey], [receiverKey]);
}

async function fetchAccounts(accounts: PublicKey[]) {
  for (let account of accounts) {
    await fetchAccount({ publicKey: account });
  }
}

async function waitTransactionAndFetchAccount(
  tx: Awaited<ReturnType<typeof Mina.transaction>>,
  keys: PrivateKey[],
  accountsToFetch?: PublicKey[]
) {
  try {
    await tx.prove();
    const pendingTransaction = await tx.sign(keys).send();

    console.log(`Tx hash: ${pendingTransaction.hash}`);
    const status = await pendingTransaction.safeWait();
    if (status.status === 'rejected') {
      throw new Error(
        'Transaction was rejected: ' + JSON.stringify(status.errors, null, 2)
      );
    }

    if (accountsToFetch) {
      await fetchAccounts(accountsToFetch);
    }
  } catch (error) {
    console.log('error', error);
    throw error;
  }
}

async function deploySettlementContract(
  signerPrivateKey: PrivateKey,
  contractPrivateKey: PrivateKey = PrivateKey.random(),
  fee: number = 1e9
) {
  const contractInstance = new SettlementContract(
    contractPrivateKey.toPublicKey()
  );
  const signerPublicKey = signerPrivateKey.toPublicKey();

  const deployTx = await Mina.transaction(
    { sender: signerPublicKey, fee },
    async () => {
      AccountUpdate.fundNewAccount(signerPublicKey);
      await contractInstance.deploy();
    }
  );

  await waitTransactionAndFetchAccount(
    deployTx,
    [signerPrivateKey, contractPrivateKey],
    [contractInstance.address]
  );

  return contractPrivateKey;
}

async function deployAndInitializeContract(
  signerPrivateKey: PrivateKey,
  contractPrivateKey: PrivateKey = PrivateKey.random(),
  validatorList: List = mockValidatorList,
  fee: number = 1e9
) {
  const contractInstance = new SettlementContract(
    contractPrivateKey.toPublicKey()
  );
  const signerPublicKey = signerPrivateKey.toPublicKey();

  const deployTx = await Mina.transaction(
    { sender: signerPublicKey, fee },
    async () => {
      AccountUpdate.fundNewAccount(signerPublicKey);
      await contractInstance.deploy();
      await contractInstance.initialize(validatorList.hash);
    }
  );

  await waitTransactionAndFetchAccount(
    deployTx,
    [signerPrivateKey, contractPrivateKey],
    [contractInstance.address]
  );

  return contractPrivateKey;
}
