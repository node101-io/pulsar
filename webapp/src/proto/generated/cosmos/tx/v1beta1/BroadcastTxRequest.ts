// Original file: src/proto/tx_service.proto

import type { BroadcastMode as _cosmos_tx_v1beta1_BroadcastMode, BroadcastMode__Output as _cosmos_tx_v1beta1_BroadcastMode__Output } from '../../../cosmos/tx/v1beta1/BroadcastMode';

export interface BroadcastTxRequest {
  'txBytes'?: (Buffer | Uint8Array | string);
  'mode'?: (_cosmos_tx_v1beta1_BroadcastMode);
}

export interface BroadcastTxRequest__Output {
  'txBytes': (Buffer);
  'mode': (_cosmos_tx_v1beta1_BroadcastMode__Output);
}
