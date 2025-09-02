package main

import (
  "context"
  "encoding/hex"
  "fmt"
  "log"
  "os"
  "strconv"
  "time"

  "cosmossdk.io/math"
  rpchttp "github.com/cometbft/cometbft/rpc/client/http"

  "github.com/cosmos/cosmos-sdk/client"
  sdktx "github.com/cosmos/cosmos-sdk/client/tx"
  "github.com/cosmos/cosmos-sdk/codec"
  codectypes "github.com/cosmos/cosmos-sdk/codec/types"
  "github.com/cosmos/cosmos-sdk/crypto/keys/secp256k1"
  "github.com/cosmos/cosmos-sdk/std"
  sdk "github.com/cosmos/cosmos-sdk/types"
  "github.com/cosmos/cosmos-sdk/types/tx/signing"
  auth "github.com/cosmos/cosmos-sdk/x/auth"
  xauthsigning "github.com/cosmos/cosmos-sdk/x/auth/signing"
  authtx "github.com/cosmos/cosmos-sdk/x/auth/tx"
  authtypes "github.com/cosmos/cosmos-sdk/x/auth/types"

  // BRIDGE TYPES — yeni path
  bridgetypes "github.com/node101-io/pulsar/chain/x/bridge/types"
)

/* ========= Config ========= */

// ENV ile değiştirilebilir (yoksa default’lar kullanılır)
const (
  // Cosmos secp256k1 private key hex (32-byte / 64-hex) — ENV: PRIVATE_KEY_HEX
  DEFAULT_PRIVATE_KEY_HEX = "f207b770a44cda7c69978f712e39b3007215c9bcbf97c795ae59e033289862cc"

  // RPC — ENV: RPC_ENDPOINT
  DEFAULT_RPC_ENDPOINT = "tcp://5.9.42.22:26657"

  // Chain prefix — ENV: BECH32_PREFIX (örn "pulsar")
  DEFAULT_BECH32_PREFIX = "consumer"

  // Fee denom — ENV: FEE_DENOM (örn "upulsar" ya da "stake")
  DEFAULT_FEE_DENOM = "stake"

  // Fee amount — ENV: FEE_AMOUNT (int)
  DEFAULT_FEE_AMOUNT = 5

  // Lock amount — ENV: LOCK_AMOUNT (int)
  DEFAULT_LOCK_AMOUNT = 1000

  // Resolve için witness — ENV: MERKLE_WITNESS (boş bırakılabilir ama zincir tarafı isteyebilir)
  DEFAULT_MERKLE_WITNESS = "node101"

  // Resolve ActionType — ENV: ACTION_TYPE (örn "withdraw")
  DEFAULT_ACTION_TYPE = "deposit"
)

/* ========= Types ========= */

type TransactionConfig struct {
  Codec             codec.Codec
  TxConfig          client.TxConfig
  InterfaceRegistry codectypes.InterfaceRegistry
  ChainID           string
  RPCEndpoint       string
  RPCClient         *rpchttp.HTTP
}

type AccountInfo struct {
  AccountNumber uint64
  Sequence      uint64
  Address       sdk.AccAddress
}

/* ========= Helpers ========= */

func getenv(key, def string) string {
  if v := os.Getenv(key); v != "" {
    return v
  }
  return def
}
func getenvInt(key string, def int64) int64 {
  if v := os.Getenv(key); v != "" {
    n, err := strconv.ParseInt(v, 10, 64)
    if err == nil {
      return n
    }
  }
  return def
}

func setPrefixes() {
  cfg := sdk.GetConfig()
  prefix := getenv("BECH32_PREFIX", DEFAULT_BECH32_PREFIX)
  cfg.SetBech32PrefixForAccount(prefix, prefix+"pub")
  cfg.SetBech32PrefixForValidator(prefix+"valoper", prefix+"valoperpub")
  cfg.SetBech32PrefixForConsensusNode(prefix+"valcons", prefix+"valconspub")
  cfg.Seal()
}

func initializeSDK() *TransactionConfig {
  fmt.Println("🔧 Initializing Cosmos SDK...")

  setPrefixes()

  // interface registry + codec
  interfaceRegistry := codectypes.NewInterfaceRegistry()
  protoCodec := codec.NewProtoCodec(interfaceRegistry)

  // register std & auth
  std.RegisterInterfaces(interfaceRegistry)
  auth.AppModuleBasic{}.RegisterInterfaces(interfaceRegistry)

  // register bridge module interfaces (kritik)
  bridgetypes.RegisterInterfaces(interfaceRegistry)

  txConfig := authtx.NewTxConfig(protoCodec, authtx.DefaultSignModes)

  fmt.Println("✅ SDK configuration completed!")

  return &TransactionConfig{
    Codec:             protoCodec,
    TxConfig:          txConfig,
    InterfaceRegistry: interfaceRegistry,
  }
}

func (tc *TransactionConfig) setupRPCConnection() error {
  tc.RPCEndpoint = getenv("RPC_ENDPOINT", DEFAULT_RPC_ENDPOINT)
  fmt.Printf("🔗 RPC: %s\n", tc.RPCEndpoint)

  cli, err := rpchttp.New(tc.RPCEndpoint, "/websocket")
  if err != nil {
    return fmt.Errorf("rpc client init failed: %w", err)
  }
  tc.RPCClient = cli

  status, err := tc.RPCClient.Status(context.Background())
  if err != nil {
    return fmt.Errorf("rpc status failed: %w", err)
  }
  tc.ChainID = status.NodeInfo.Network
	  fmt.Printf("✅ Connected. ChainID: %s, LatestHeight: %d\n", tc.ChainID, status.SyncInfo.LatestBlockHeight)
  return nil
}

func getPrivateKey() *secp256k1.PrivKey {
  hexStr := getenv("PRIVATE_KEY_HEX", DEFAULT_PRIVATE_KEY_HEX)
  if len(hexStr) != 64 {
    log.Fatalf("PRIVATE_KEY_HEX must be 64 hex chars (got len=%d)", len(hexStr))
  }
  bz := make([]byte, 32)
  for i := 0; i < 32; i++ {
    var b byte
    _, err := fmt.Sscanf(hexStr[i*2:i*2+2], "%02x", &b)
    if err != nil {
      log.Fatalf("failed to parse PRIVATE_KEY_HEX: %v", err)
    }
    bz[i] = b
  }
  return &secp256k1.PrivKey{Key: bz}
}

func getAccountInfo(clientCtx client.Context, address string) (accNum, seq uint64, err error) {
  accAddr, err := sdk.AccAddressFromBech32(address)
  if err != nil {
    return 0, 0, fmt.Errorf("bad bech32: %w", err)
  }
  queryClient := authtypes.NewQueryClient(clientCtx)
  res, err := queryClient.Account(context.Background(), &authtypes.QueryAccountRequest{Address: accAddr.String()})
  if err != nil {
    return 0, 0, fmt.Errorf("query account failed: %w", err)
  }
  var account authtypes.AccountI
  if err := clientCtx.Codec.UnpackAny(res.Account, &account); err != nil {
    return 0, 0, fmt.Errorf("unpack account failed: %w", err)
  }
  return account.GetAccountNumber(), account.GetSequence(), nil
}

func broadcast(config *TransactionConfig, txBytes []byte) (string, error) {
  clientCtx := client.Context{}.
    WithCodec(config.Codec).
    WithChainID(config.ChainID).
    WithClient(config.RPCClient).
    WithTxConfig(config.TxConfig).
    WithBroadcastMode("sync")

  resp, err := clientCtx.BroadcastTx(txBytes)
  if err != nil {
    return "", err
  }
  fmt.Printf("📡 Broadcast: code=%d hash=%s log=%s\n", resp.Code, resp.TxHash, resp.RawLog)
  return resp.TxHash, nil
}

func waitTx(config *TransactionConfig, txHash string, maxAttempts int) {
  fmt.Printf("⏳ Wait for %s\n", txHash)
  hashBytes, err := hex.DecodeString(txHash)
  if err != nil {
    fmt.Printf("hash decode err: %v\n", err)
    return
  }
  for i := 0; i < maxAttempts; i++ {
    res, err := config.RPCClient.Tx(context.Background(), hashBytes, false)
    if err == nil && res != nil {
      fmt.Printf("✅ Included at height %d\n", res.Height)
      return
    }
    time.Sleep(2 * time.Second)
  }
  fmt.Println("⚠️  Confirmation not observed (timeout)")
}

func signWithCosmosKey(
  config *TransactionConfig,
  builder client.TxBuilder,
  accNum, seq uint64,
  priv *secp256k1.PrivKey,
) error {
  // 1) boş imza
  if err := builder.SetSignatures(signing.SignatureV2{
    PubKey: priv.PubKey(),
    Data: &signing.SingleSignatureData{
      SignMode:  signing.SignMode(config.TxConfig.SignModeHandler().DefaultMode()),
      Signature: nil,
    },
    Sequence: seq,
  }); err != nil {
    return err
  }

  // 2) gerçek imza
  signerData := xauthsigning.SignerData{
    ChainID:       config.ChainID,
    AccountNumber: accNum,
    Sequence:      seq,
  }
  sig, err := sdktx.SignWithPrivKey(
    context.Background(),
    signing.SignMode(config.TxConfig.SignModeHandler().DefaultMode()),
    signerData,
    builder,
    priv,
    config.TxConfig,
    seq,
  )
  if err != nil {
    return err
  }
  return builder.SetSignatures(sig)
}

func encodeTx(config *TransactionConfig, builder client.TxBuilder) ([]byte, error) {
  return config.TxConfig.TxEncoder()(builder.GetTx())
}

/* ========= BRIDGE TX BUILDERS ========= */

func createLockForWithdrawalTx(
  config *TransactionConfig,
  creator sdk.AccAddress,
  minaPubKey string,
  amt math.Int,
) client.TxBuilder {
  txb := config.TxConfig.NewTxBuilder()

  msg := &bridgetypes.MsgLockForWithdrawal{
    Creator:       creator.String(),
    MinaPublicKey: minaPubKey,
    Amount:        amt, // plain Int — denom yok
  }
  if err := txb.SetMsgs(msg); err != nil {
    log.Fatalf("SetMsgs(lock) failed: %v", err)
  }
	  feeDenom := getenv("FEE_DENOM", DEFAULT_FEE_DENOM)
  feeAmt := getenvInt("FEE_AMOUNT", DEFAULT_FEE_AMOUNT)
  txb.SetFeeAmount(sdk.NewCoins(sdk.NewCoin(feeDenom, math.NewInt(feeAmt))))
  txb.SetGasLimit(200000)
  txb.SetMemo("LockForWithdrawal")

  return txb
}

func createResolveActionsTx(
  config *TransactionConfig,
  creator sdk.AccAddress,
  actions []bridgetypes.PulsarAction,
  nextBlockHeight uint64,
  merkleWitness string,
) client.TxBuilder {
  txb := config.TxConfig.NewTxBuilder()

  msg := &bridgetypes.MsgResolveActions{
    Creator:         creator.String(),
    Actions:         actions,
    NextBlockHeight: nextBlockHeight,
    MerkleWitness:   merkleWitness,
  }
  if err := txb.SetMsgs(msg); err != nil {
    log.Fatalf("SetMsgs(resolve) failed: %v", err)
  }

  feeDenom := getenv("FEE_DENOM", DEFAULT_FEE_DENOM)
  feeAmt := getenvInt("FEE_AMOUNT", DEFAULT_FEE_AMOUNT)
  txb.SetFeeAmount(sdk.NewCoins(sdk.NewCoin(feeDenom, math.NewInt(feeAmt))))
  txb.SetGasLimit(250000)
  txb.SetMemo("ResolveActions")

  return txb
}

/* ========= MAIN ========= */

func main() {
  fmt.Println("🚀 Bridge TX Runner (LockForWithdrawal → ResolveActions)")

  // 1) SDK & RPC
  cfg := initializeSDK()
  if err := cfg.setupRPCConnection(); err != nil {
    log.Fatalf("rpc setup failed: %v", err)
  }

  // 2) Keys & addresses
  priv := getPrivateKey()
  fromAddr := sdk.AccAddress(priv.PubKey().Address())

  fmt.Printf("🔑 From: %s\n", fromAddr.String())

  // 3) Client context & account info
  clientCtx := client.Context{}.
    WithCodec(cfg.Codec).
    WithChainID(cfg.ChainID).
    WithClient(cfg.RPCClient).
    WithTxConfig(cfg.TxConfig)

  accNum, seq, err := getAccountInfo(clientCtx, fromAddr.String())
  if err != nil {
    log.Fatalf("account query failed: %v", err)
  }
  fmt.Printf("👤 AccountNumber=%d Sequence=%d\n", accNum, seq)

  // 4) Parametreler
  lockAmount := math.NewInt(getenvInt("LOCK_AMOUNT", DEFAULT_LOCK_AMOUNT)) // Int
  // NOTE: Mina public key string — zincir ne format bekliyorsa ona uygun ver (ENV’dan alabilirsin)
  minaPubKey := getenv("MINA_PUBLIC_KEY", "2DDkL9dGaxrqG9EcSzQChqjZXJQHGbEyohxyiguiUdrMc")

  // 5) --- TX #1: LockForWithdrawal ---
  lockTx := createLockForWithdrawalTx(cfg, fromAddr, minaPubKey, lockAmount)

  if err := signWithCosmosKey(cfg, lockTx, accNum, seq, priv); err != nil {
    log.Fatalf("sign lock failed: %v", err)
  }
  lockBytes, err := encodeTx(cfg, lockTx)
  if err != nil {
    log.Fatalf("encode lock failed: %v", err)
  }
  lockHash, err := broadcast(cfg, lockBytes)
  if err != nil {
    log.Fatalf("broadcast lock failed: %v", err)
  }
  // Beklemek istersen:
  waitTx(cfg, lockHash, 10)

  // Sequence +1
  seq++

  // 6) Resolve için yardımcı alanlar
  status, err := cfg.RPCClient.Status(context.Background())
  if err != nil {
    log.Fatalf("status failed: %v", err)
  }
  nextHeight := uint64(status.SyncInfo.LatestBlockHeight + 1)

  merkleWitness := getenv("MERKLE_WITNESS", DEFAULT_MERKLE_WITNESS)
  actionType := getenv("ACTION_TYPE", DEFAULT_ACTION_TYPE)

  actions := []bridgetypes.PulsarAction{
    {
      PublicKey:   minaPubKey,
      Amount:      lockAmount, // örnek: lock ile aynı miktar
      ActionType:  actionType, // örn: "withdraw"
      BlockHeight: nextHeight, // örnek atama
    },
  }

  // 7) --- TX #2: ResolveActions ---
  resolveTx := createResolveActionsTx(cfg, fromAddr, actions, nextHeight, merkleWitness)

  if err := signWithCosmosKey(cfg, resolveTx, accNum, seq, priv); err != nil {
    log.Fatalf("sign resolve failed: %v", err)
  }
  resolveBytes, err := encodeTx(cfg, resolveTx)
  if err != nil {
    log.Fatalf("encode resolve failed: %v", err)
  }
  resolveHash, err := broadcast(cfg, resolveBytes)
  if err != nil {
    log.Fatalf("broadcast resolve failed: %v", err)
  }
  waitTx(cfg, resolveHash, 10)

  fmt.Println("\n=== DONE ===")
  fmt.Printf("LockForWithdrawal: %s\n", lockHash)
  fmt.Printf("ResolveActions   : %s\n", resolveHash)
}