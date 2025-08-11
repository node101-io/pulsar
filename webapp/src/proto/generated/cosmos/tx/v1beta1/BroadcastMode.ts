// Original file: src/proto/tx_service.proto

export const BroadcastMode = {
  BROADCAST_MODE_UNSPECIFIED: 'BROADCAST_MODE_UNSPECIFIED',
  BROADCAST_MODE_BLOCK: 'BROADCAST_MODE_BLOCK',
  BROADCAST_MODE_SYNC: 'BROADCAST_MODE_SYNC',
  BROADCAST_MODE_ASYNC: 'BROADCAST_MODE_ASYNC',
} as const;

export type BroadcastMode =
  | 'BROADCAST_MODE_UNSPECIFIED'
  | 0
  | 'BROADCAST_MODE_BLOCK'
  | 1
  | 'BROADCAST_MODE_SYNC'
  | 2
  | 'BROADCAST_MODE_ASYNC'
  | 3

export type BroadcastMode__Output = typeof BroadcastMode[keyof typeof BroadcastMode]
