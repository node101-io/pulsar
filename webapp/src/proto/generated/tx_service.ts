import type * as grpc from '@grpc/grpc-js';
import type { EnumTypeDefinition, MessageTypeDefinition } from '@grpc/proto-loader';

import type { ABCIMessageLog as _cosmos_tx_v1beta1_ABCIMessageLog, ABCIMessageLog__Output as _cosmos_tx_v1beta1_ABCIMessageLog__Output } from './cosmos/tx/v1beta1/ABCIMessageLog';
import type { Attribute as _cosmos_tx_v1beta1_Attribute, Attribute__Output as _cosmos_tx_v1beta1_Attribute__Output } from './cosmos/tx/v1beta1/Attribute';
import type { BroadcastTxRequest as _cosmos_tx_v1beta1_BroadcastTxRequest, BroadcastTxRequest__Output as _cosmos_tx_v1beta1_BroadcastTxRequest__Output } from './cosmos/tx/v1beta1/BroadcastTxRequest';
import type { BroadcastTxResponse as _cosmos_tx_v1beta1_BroadcastTxResponse, BroadcastTxResponse__Output as _cosmos_tx_v1beta1_BroadcastTxResponse__Output } from './cosmos/tx/v1beta1/BroadcastTxResponse';
import type { Event as _cosmos_tx_v1beta1_Event, Event__Output as _cosmos_tx_v1beta1_Event__Output } from './cosmos/tx/v1beta1/Event';
import type { ServiceClient as _cosmos_tx_v1beta1_ServiceClient, ServiceDefinition as _cosmos_tx_v1beta1_ServiceDefinition } from './cosmos/tx/v1beta1/Service';
import type { StringEvent as _cosmos_tx_v1beta1_StringEvent, StringEvent__Output as _cosmos_tx_v1beta1_StringEvent__Output } from './cosmos/tx/v1beta1/StringEvent';
import type { TxResponse as _cosmos_tx_v1beta1_TxResponse, TxResponse__Output as _cosmos_tx_v1beta1_TxResponse__Output } from './cosmos/tx/v1beta1/TxResponse';
import type { Any as _google_protobuf_Any, Any__Output as _google_protobuf_Any__Output } from './google/protobuf/Any';

type SubtypeConstructor<Constructor extends new (...args: any) => any, Subtype> = {
  new(...args: ConstructorParameters<Constructor>): Subtype;
};

export interface ProtoGrpcType {
  cosmos: {
    tx: {
      v1beta1: {
        ABCIMessageLog: MessageTypeDefinition<_cosmos_tx_v1beta1_ABCIMessageLog, _cosmos_tx_v1beta1_ABCIMessageLog__Output>
        Attribute: MessageTypeDefinition<_cosmos_tx_v1beta1_Attribute, _cosmos_tx_v1beta1_Attribute__Output>
        BroadcastMode: EnumTypeDefinition
        BroadcastTxRequest: MessageTypeDefinition<_cosmos_tx_v1beta1_BroadcastTxRequest, _cosmos_tx_v1beta1_BroadcastTxRequest__Output>
        BroadcastTxResponse: MessageTypeDefinition<_cosmos_tx_v1beta1_BroadcastTxResponse, _cosmos_tx_v1beta1_BroadcastTxResponse__Output>
        Event: MessageTypeDefinition<_cosmos_tx_v1beta1_Event, _cosmos_tx_v1beta1_Event__Output>
        Service: SubtypeConstructor<typeof grpc.Client, _cosmos_tx_v1beta1_ServiceClient> & { service: _cosmos_tx_v1beta1_ServiceDefinition }
        StringEvent: MessageTypeDefinition<_cosmos_tx_v1beta1_StringEvent, _cosmos_tx_v1beta1_StringEvent__Output>
        TxResponse: MessageTypeDefinition<_cosmos_tx_v1beta1_TxResponse, _cosmos_tx_v1beta1_TxResponse__Output>
      }
    }
  }
  google: {
    protobuf: {
      Any: MessageTypeDefinition<_google_protobuf_Any, _google_protobuf_Any__Output>
    }
  }
}

