// Original file: src/proto/tx_service.proto

import type { ABCIMessageLog as _cosmos_tx_v1beta1_ABCIMessageLog, ABCIMessageLog__Output as _cosmos_tx_v1beta1_ABCIMessageLog__Output } from '../../../cosmos/tx/v1beta1/ABCIMessageLog';
import type { Any as _google_protobuf_Any, Any__Output as _google_protobuf_Any__Output } from '../../../google/protobuf/Any';
import type { Event as _cosmos_tx_v1beta1_Event, Event__Output as _cosmos_tx_v1beta1_Event__Output } from '../../../cosmos/tx/v1beta1/Event';
import type { Long } from '@grpc/proto-loader';

export interface TxResponse {
  'code'?: (number);
  'data'?: (string);
  'rawLog'?: (string);
  'logs'?: (_cosmos_tx_v1beta1_ABCIMessageLog)[];
  'info'?: (string);
  'gasWanted'?: (number | string | Long);
  'gasUsed'?: (number | string | Long);
  'tx'?: (_google_protobuf_Any | null);
  'timestamp'?: (string);
  'events'?: (_cosmos_tx_v1beta1_Event)[];
  'codespace'?: (string);
  'txhash'?: (string);
}

export interface TxResponse__Output {
  'code': (number);
  'data': (string);
  'rawLog': (string);
  'logs': (_cosmos_tx_v1beta1_ABCIMessageLog__Output)[];
  'info': (string);
  'gasWanted': (string);
  'gasUsed': (string);
  'tx': (_google_protobuf_Any__Output | null);
  'timestamp': (string);
  'events': (_cosmos_tx_v1beta1_Event__Output)[];
  'codespace': (string);
  'txhash': (string);
}
