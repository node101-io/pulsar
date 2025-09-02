// Original file: src/proto/tx_service.proto

import type * as grpc from '@grpc/grpc-js'
import type { MethodDefinition } from '@grpc/proto-loader'
import type { BroadcastTxRequest as _cosmos_tx_v1beta1_BroadcastTxRequest, BroadcastTxRequest__Output as _cosmos_tx_v1beta1_BroadcastTxRequest__Output } from '../../../cosmos/tx/v1beta1/BroadcastTxRequest';
import type { BroadcastTxResponse as _cosmos_tx_v1beta1_BroadcastTxResponse, BroadcastTxResponse__Output as _cosmos_tx_v1beta1_BroadcastTxResponse__Output } from '../../../cosmos/tx/v1beta1/BroadcastTxResponse';

export interface ServiceClient extends grpc.Client {
  BroadcastTx(argument: _cosmos_tx_v1beta1_BroadcastTxRequest, metadata: grpc.Metadata, options: grpc.CallOptions, callback: grpc.requestCallback<_cosmos_tx_v1beta1_BroadcastTxResponse__Output>): grpc.ClientUnaryCall;
  BroadcastTx(argument: _cosmos_tx_v1beta1_BroadcastTxRequest, metadata: grpc.Metadata, callback: grpc.requestCallback<_cosmos_tx_v1beta1_BroadcastTxResponse__Output>): grpc.ClientUnaryCall;
  BroadcastTx(argument: _cosmos_tx_v1beta1_BroadcastTxRequest, options: grpc.CallOptions, callback: grpc.requestCallback<_cosmos_tx_v1beta1_BroadcastTxResponse__Output>): grpc.ClientUnaryCall;
  BroadcastTx(argument: _cosmos_tx_v1beta1_BroadcastTxRequest, callback: grpc.requestCallback<_cosmos_tx_v1beta1_BroadcastTxResponse__Output>): grpc.ClientUnaryCall;
  broadcastTx(argument: _cosmos_tx_v1beta1_BroadcastTxRequest, metadata: grpc.Metadata, options: grpc.CallOptions, callback: grpc.requestCallback<_cosmos_tx_v1beta1_BroadcastTxResponse__Output>): grpc.ClientUnaryCall;
  broadcastTx(argument: _cosmos_tx_v1beta1_BroadcastTxRequest, metadata: grpc.Metadata, callback: grpc.requestCallback<_cosmos_tx_v1beta1_BroadcastTxResponse__Output>): grpc.ClientUnaryCall;
  broadcastTx(argument: _cosmos_tx_v1beta1_BroadcastTxRequest, options: grpc.CallOptions, callback: grpc.requestCallback<_cosmos_tx_v1beta1_BroadcastTxResponse__Output>): grpc.ClientUnaryCall;
  broadcastTx(argument: _cosmos_tx_v1beta1_BroadcastTxRequest, callback: grpc.requestCallback<_cosmos_tx_v1beta1_BroadcastTxResponse__Output>): grpc.ClientUnaryCall;
  
}

export interface ServiceHandlers extends grpc.UntypedServiceImplementation {
  BroadcastTx: grpc.handleUnaryCall<_cosmos_tx_v1beta1_BroadcastTxRequest__Output, _cosmos_tx_v1beta1_BroadcastTxResponse>;
  
}

export interface ServiceDefinition extends grpc.ServiceDefinition {
  BroadcastTx: MethodDefinition<_cosmos_tx_v1beta1_BroadcastTxRequest, _cosmos_tx_v1beta1_BroadcastTxResponse, _cosmos_tx_v1beta1_BroadcastTxRequest__Output, _cosmos_tx_v1beta1_BroadcastTxResponse__Output>
}
