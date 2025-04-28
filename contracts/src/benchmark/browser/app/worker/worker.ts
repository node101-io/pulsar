import 'reflect-metadata';
import { Mina } from 'o1js';

const state = {};
export type State = typeof state;

const functions = {
  // eslint-disable-next-line no-unused-vars
  setActiveInstanceToLocal: async (args: {}) => {
    const Local = await Mina.LocalBlockchain();
    console.log('Devnet network instance configured.');
    Mina.setActiveInstance(Local);
  },
};
export type WorkerFunctions = keyof typeof functions;

export type ZkappWorkerRequest = {
  id: number;
  fn: WorkerFunctions;
  args: any;
};

export type ZkappWorkerReponse = {
  id: number;
  data: any;
};

if (typeof window !== 'undefined') {
  addEventListener(
    'message',
    async (event: MessageEvent<ZkappWorkerRequest>) => {
      const returnData = await functions[event.data.fn](event.data.args);

      const message: ZkappWorkerReponse = {
        id: event.data.id,
        data: returnData,
      };
      postMessage(message);
    }
  );
}

console.log('Web Worker Successfully Initialized.');
