import * as path from 'path';
import * as fs from 'fs';
import { SettlementContract } from '../SettlementContract.js';
import {
  ACTION_QUEUE_SIZE,
  AGGREGATE_THRESHOLD,
  BATCH_SIZE,
  VALIDATOR_NUMBER,
} from './constants.js';

export {
  writeJsonLog,
  log,
  table,
  logZkappState,
  enableLogs,
  analyzeMethods,
  logParams,
};

function writeJsonLog(fileName: string, data: any) {
  const dir = path.join(process.cwd(), 'logs');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, fileName);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

let logsEnabled = false;

function log(...args: any[]) {
  if (logsEnabled) {
    console.log(...args);
  }
}

function table(...args: any[]) {
  if (logsEnabled) {
    console.table(...args);
  }
}

function enableLogs() {
  logsEnabled = true;
}

function logZkappState(label: string, zkapp: SettlementContract) {
  console.log(`${label.toUpperCase()}:`);
  console.table({
    actionState: zkapp.actionState.get().toString(),
    merkleListRoot: zkapp.merkleListRoot.get().toString(),
    stateRoot: zkapp.stateRoot.get().toString(),
    blockHeight: zkapp.blockHeight.get().toString(),
    depositListHash: zkapp.depositListHash.get().toString(),
    withdrawalListHash: zkapp.withdrawalListHash.get().toString(),
    accountActionState: zkapp.account.actionState.get().toString(),
  });
}

function analyzeMethods(data: any) {
  if (!logsEnabled) return;
  const tableData = Object.entries(data).map(([methodName, details]) => ({
    method: methodName,
    rows: (details as any).rows,
  }));
  console.table(tableData);
}

function logParams() {
  table([VALIDATOR_NUMBER, AGGREGATE_THRESHOLD, BATCH_SIZE, ACTION_QUEUE_SIZE]);
}
