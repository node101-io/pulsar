// import {
//   Field,
//   Mina,
//   PrivateKey,
//   AccountUpdate,
//   Signature,
//   UInt64,
//   PublicKey,
//   Lightnet,
//   fetchAccount,
// } from 'o1js';
// import { log } from '../../utils/loggers.js';

// const logsEnabled = process.env.LOGS_ENABLED === '1';
// const testEnvironment = process.env.TEST_ENV ?? 'local';
// const localTest = testEnvironment === 'local';
// let fee = localTest ? 0 : 1e9;

// async function waitTransactionAndFetchAccount(
//   tx: Awaited<ReturnType<typeof Mina.transaction>>,
//   keys: PrivateKey[],
//   accountsToFetch?: PublicKey[]
// ) {
//   try {
//     log('proving and sending transaction');
//     await tx.prove();
//     const pendingTransaction = await tx.sign(keys).send();

//     log('waiting for transaction to be included in a block');
//     if (!localTest) {
//       log('Hash: ', pendingTransaction.hash);
//       const status = await pendingTransaction.safeWait();
//       if (status.status === 'rejected') {
//         log('Transaction rejected', JSON.stringify(status.errors));
//         throw new Error(
//           'Transaction was rejected: ' + JSON.stringify(status.errors)
//         );
//       }

//       if (accountsToFetch) {
//         await fetchAccounts(accountsToFetch);
//       }
//     }
//   } catch (error) {
//     log('error', error);
//     throw error;
//   }
// }

// async function fetchAccounts(accounts: PublicKey[]) {
//   if (localTest) return;
//   for (let account of accounts) {
//     await fetchAccount({ publicKey: account });
//   }
// }
