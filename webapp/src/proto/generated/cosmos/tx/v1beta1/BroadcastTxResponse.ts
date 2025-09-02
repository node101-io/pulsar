// Original file: src/proto/tx_service.proto

import type { TxResponse as _cosmos_tx_v1beta1_TxResponse, TxResponse__Output as _cosmos_tx_v1beta1_TxResponse__Output } from '../../../cosmos/tx/v1beta1/TxResponse';

export interface BroadcastTxResponse {
  'txResponse'?: (_cosmos_tx_v1beta1_TxResponse | null);
}

export interface BroadcastTxResponse__Output {
  'txResponse': (_cosmos_tx_v1beta1_TxResponse__Output | null);
}
