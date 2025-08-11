// Original file: src/proto/tx_service.proto

import type { Attribute as _cosmos_tx_v1beta1_Attribute, Attribute__Output as _cosmos_tx_v1beta1_Attribute__Output } from '../../../cosmos/tx/v1beta1/Attribute';

export interface StringEvent {
  'type'?: (string);
  'attributes'?: (_cosmos_tx_v1beta1_Attribute)[];
}

export interface StringEvent__Output {
  'type': (string);
  'attributes': (_cosmos_tx_v1beta1_Attribute__Output)[];
}
