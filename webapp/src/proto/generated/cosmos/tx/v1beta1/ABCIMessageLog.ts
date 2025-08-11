// Original file: src/proto/tx_service.proto

import type { StringEvent as _cosmos_tx_v1beta1_StringEvent, StringEvent__Output as _cosmos_tx_v1beta1_StringEvent__Output } from '../../../cosmos/tx/v1beta1/StringEvent';

export interface ABCIMessageLog {
  'msgIndex'?: (number);
  'log'?: (string);
  'events'?: (_cosmos_tx_v1beta1_StringEvent)[];
}

export interface ABCIMessageLog__Output {
  'msgIndex': (number);
  'log': (string);
  'events': (_cosmos_tx_v1beta1_StringEvent__Output)[];
}
