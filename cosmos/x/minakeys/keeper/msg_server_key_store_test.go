package keeper_test

import (
	"crypto/rand"
	"encoding/hex"
	"strconv"
	"testing"

	ckeys "github.com/cosmos/cosmos-sdk/crypto/keys/secp256k1"
	sdk "github.com/cosmos/cosmos-sdk/types"
	"github.com/stretchr/testify/require"

	"github.com/node101-io/mina-signer-go/keys"
	keepertest "github.com/node101-io/pulsar/cosmos/testutil/keeper"
	"github.com/node101-io/pulsar/cosmos/x/minakeys/keeper"
	"github.com/node101-io/pulsar/cosmos/x/minakeys/types"
)

// Prevent strconv unused error
var _ = strconv.IntSize

// TestCreateKeyStore_Success tests that a valid CreateKeyStore message succeeds.
func TestCreateKeyStore_Success(t *testing.T) {
	// fresh keeper+context
	k, ctx := keepertest.MinakeysKeeper(t)
	srv := keeper.NewMsgServerImpl(k)

	// --- generate Cosmos secp256k1 keypair ---
	cosmosPriv := ckeys.GenPrivKey()
	cosmosPub := cosmosPriv.PubKey().Bytes()
	cosmosPubHex := hex.EncodeToString(cosmosPub)

	// derive creator address from cosmosPub
	creator := sdk.AccAddress(cosmosPriv.PubKey().Address()).String()

	// Generate a private key from random bytes
	var randomBytes [32]byte
	rand.Read(randomBytes[:])
	minaPriv := keys.NewPrivateKeyFromBytes(randomBytes)
	minaPub := minaPriv.ToPublicKey()

	minaPubBytes, err := minaPub.MarshalBytes()
	require.NoError(t, err)
	minaPubHex := hex.EncodeToString(minaPubBytes)

	// --- signatures ---
	// Mina signs the Cosmos public key hex
	minaSig, err := minaPriv.SignMessage(cosmosPubHex, types.DevnetNetworkID)
	require.NoError(t, err)
	minaSigBytes, err := minaSig.MarshalBytes()
	require.NoError(t, err)

	// Cosmos signs the Mina public key hex
	cosmosSig, err := cosmosPriv.Sign([]byte(minaPubHex))
	require.NoError(t, err)

	// --- build message ---
	msg := &types.MsgCreateKeyStore{
		Creator:         creator,
		CosmosPublicKey: cosmosPubHex,
		MinaPublicKey:   minaPubHex,
		CosmosSignature: cosmosSig,
		MinaSignature:   minaSigBytes,
	}

	// --- call CreateKeyStore with wrapped context ---
	_, err = srv.CreateKeyStore(ctx, msg)
	require.NoError(t, err)
}

// TestCreateKeyStore_DuplicateIndex tests that creating a duplicate entry fails.
func TestCreateKeyStore_DuplicateIndex(t *testing.T) {
	k, ctx := keepertest.MinakeysKeeper(t)
	srv := keeper.NewMsgServerImpl(k)

	cosmosPriv := ckeys.GenPrivKey()
	cosmosPubHex := hex.EncodeToString(cosmosPriv.PubKey().Bytes())
	creator := sdk.AccAddress(cosmosPriv.PubKey().Address()).String()

	// Generate a private key from random bytes
	var randomBytes [32]byte
	rand.Read(randomBytes[:])
	minaPriv := keys.NewPrivateKeyFromBytes(randomBytes)
	minaPub := minaPriv.ToPublicKey()

	minaPubBytes, err := minaPub.MarshalBytes()
	require.NoError(t, err)
	minaPubHex := hex.EncodeToString(minaPubBytes)

	cosmosSig, err := cosmosPriv.Sign([]byte(minaPubHex))
	require.NoError(t, err)
	minaSig, err := minaPriv.SignMessage(cosmosPubHex, types.DevnetNetworkID)
	require.NoError(t, err)
	minaSigBytes, err := minaSig.MarshalBytes()
	require.NoError(t, err)

	msg := &types.MsgCreateKeyStore{
		Creator:         creator,
		CosmosPublicKey: cosmosPubHex,
		MinaPublicKey:   minaPubHex,
		CosmosSignature: cosmosSig,
		MinaSignature:   minaSigBytes,
	}

	// first insertion should succeed
	_, err = srv.CreateKeyStore(ctx, msg)
	require.NoError(t, err)

	// second insertion with same index should error
	_, err = srv.CreateKeyStore(ctx, msg)
	require.Error(t, err)
	require.Contains(t, err.Error(), "cosmosPublicKey already registered")
}

// TestCreateKeyStore_InvalidCosmosSignature tests rejection on bad cosmos signature.
func TestCreateKeyStore_InvalidCosmosSignature(t *testing.T) {
	k, ctx := keepertest.MinakeysKeeper(t)
	srv := keeper.NewMsgServerImpl(k)

	cosmosPriv := ckeys.GenPrivKey()
	cosmosPubHex := hex.EncodeToString(cosmosPriv.PubKey().Bytes())
	creator := sdk.AccAddress(cosmosPriv.PubKey().Address()).String()

	// Generate a private key from random bytes
	var randomBytes [32]byte
	rand.Read(randomBytes[:])
	minaPriv := keys.NewPrivateKeyFromBytes(randomBytes)
	minaPub := minaPriv.ToPublicKey()

	minaPubBytes, err := minaPub.MarshalBytes()
	require.NoError(t, err)
	minaPubHex := hex.EncodeToString(minaPubBytes)

	// valid mina signature (on cosmosPubHex)
	minaSig, err := minaPriv.SignMessage(cosmosPubHex, types.DevnetNetworkID)
	require.NoError(t, err)
	minaSigBytes, err := minaSig.MarshalBytes()
	require.NoError(t, err)

	// invalid cosmos signature (on minaPubHex)
	cosmosSig, err := cosmosPriv.Sign([]byte(minaPubHex))
	require.NoError(t, err)
	cosmosSig[0] ^= 0xFF

	msg := &types.MsgCreateKeyStore{
		Creator:         creator,
		CosmosPublicKey: cosmosPubHex,
		MinaPublicKey:   minaPubHex,
		CosmosSignature: cosmosSig,
		MinaSignature:   minaSigBytes,
	}

	_, err = srv.CreateKeyStore(ctx, msg)
	require.Error(t, err)
	require.Contains(t, err.Error(), "invalid cosmos signature")
}

// TestCreateKeyStore_InvalidMinaSignature tests rejection on bad mina signature.
func TestCreateKeyStore_InvalidMinaSignature(t *testing.T) {
	k, ctx := keepertest.MinakeysKeeper(t)
	srv := keeper.NewMsgServerImpl(k)

	cosmosPriv := ckeys.GenPrivKey()
	cosmosPubHex := hex.EncodeToString(cosmosPriv.PubKey().Bytes())
	creator := sdk.AccAddress(cosmosPriv.PubKey().Address()).String()

	// Generate a private key from random bytes
	var randomBytes [32]byte
	rand.Read(randomBytes[:])
	minaPriv := keys.NewPrivateKeyFromBytes(randomBytes)
	minaPub := minaPriv.ToPublicKey()

	minaPubBytes, err := minaPub.MarshalBytes()
	require.NoError(t, err)
	minaPubHex := hex.EncodeToString(minaPubBytes)

	// valid cosmos signature
	cosmosSig, err := cosmosPriv.Sign([]byte(minaPubHex))
	require.NoError(t, err)

	// invalid mina signature
	minaSig, err := minaPriv.SignMessage(cosmosPubHex, types.DevnetNetworkID)
	require.NoError(t, err)
	minaSigBytes, err := minaSig.MarshalBytes()
	require.NoError(t, err)
	minaSigBytes[0] ^= 0xFF

	msg := &types.MsgCreateKeyStore{
		Creator:         creator,
		CosmosPublicKey: cosmosPubHex,
		MinaPublicKey:   minaPubHex,
		CosmosSignature: cosmosSig,
		MinaSignature:   minaSigBytes,
	}

	_, err = srv.CreateKeyStore(ctx, msg)
	require.Error(t, err)
	require.Contains(t, err.Error(), "invalid mina signature")
}

/*

// It'll be determined in future if we're going to add update functionality for validator keys.

func TestUpdateKeyStore_IndexNotSet(t *testing.T) {
	k, ctx := keepertest.MinakeysKeeper(t)
	srv := keeper.NewMsgServerImpl(k)

	// generate cosmos public key
	cosmosPriv := ckeys.GenPrivKey()
	cosmosPubHex := hex.EncodeToString(cosmosPriv.PubKey().Bytes())

	// generate a Mina public key
	minaPub, _, err := mina.NewKeys()
	require.NoError(t, err)
	minaPubBytes, err := minaPub.MarshalBinary()
	require.NoError(t, err)
	minaPubHex := hex.EncodeToString(minaPubBytes)

	// build update message without prior creation
	msg := &types.MsgUpdateKeyStore{
		Creator:         "cosmos1testaddress...",
		CosmosPublicKey: cosmosPubHex,
		MinaPublicKey:   minaPubHex,
	}

	// call UpdateKeyStore and expect KeyNotFound error
	_, err = srv.UpdateKeyStore(ctx, msg)
	require.Error(t, err)
	require.Contains(t, err.Error(), "index not set")
}

func TestUpdateKeyStore_IncorrectOwner(t *testing.T) {
	k, ctx := keepertest.MinakeysKeeper(t)
	srv := keeper.NewMsgServerImpl(k)

	// generate cosmos public key
	cosmosPriv := ckeys.GenPrivKey()
	cosmosPubHex := hex.EncodeToString(cosmosPriv.PubKey().Bytes())

	// initial Mina public key
	oldMinaPub, _, err := mina.NewKeys()
	require.NoError(t, err)
	oldMinaPubBytes, err := oldMinaPub.MarshalBinary()
	require.NoError(t, err)
	oldMinaPubHex := hex.EncodeToString(oldMinaPubBytes)

	// set initial KeyStore with creator A
	initialCreator := "cosmos1initial..."
	k.SetKeyStore(ctx, types.KeyStore{
		Creator:         initialCreator,
		CosmosPublicKey: cosmosPubHex,
		MinaPublicKey:   oldMinaPubHex,
	})

	// generate new Mina public key for update
	newMinaPub, _, err := mina.NewKeys()
	require.NoError(t, err)
	newMinaPubBytes, err := newMinaPub.MarshalBinary()
	require.NoError(t, err)
	newMinaPubHex := hex.EncodeToString(newMinaPubBytes)

	// build update message with incorrect creator
	msg := &types.MsgUpdateKeyStore{
		Creator:         "cosmos1otherowner...",
		CosmosPublicKey: cosmosPubHex,
		MinaPublicKey:   newMinaPubHex,
	}

	// call UpdateKeyStore and expect Unauthorized error
	_, err = srv.UpdateKeyStore(ctx, msg)
	require.Error(t, err)
	require.Contains(t, err.Error(), "incorrect owner")
}

func TestUpdateKeyStore_Success(t *testing.T) {
	k, ctx := keepertest.MinakeysKeeper(t)
	srv := keeper.NewMsgServerImpl(k)

	// generate cosmos public key
	cosmosPriv := ckeys.GenPrivKey()
	cosmosPubHex := hex.EncodeToString(cosmosPriv.PubKey().Bytes())

	// initial Mina public key
	oldMinaPub, _, err := mina.NewKeys()
	require.NoError(t, err)
	oldMinaPubBytes, err := oldMinaPub.MarshalBinary()
	require.NoError(t, err)
	oldMinaPubHex := hex.EncodeToString(oldMinaPubBytes)

	// set initial KeyStore with creator A
	creator := "cosmos1testaddress..."
	k.SetKeyStore(ctx, types.KeyStore{
		Creator:         creator,
		CosmosPublicKey: cosmosPubHex,
		MinaPublicKey:   oldMinaPubHex,
	})

	// generate new Mina public key for update
	newMinaPub, _, err := mina.NewKeys()
	require.NoError(t, err)
	newMinaPubBytes, err := newMinaPub.MarshalBinary()
	require.NoError(t, err)
	newMinaPubHex := hex.EncodeToString(newMinaPubBytes)

	// build update message with correct creator
	msg := &types.MsgUpdateKeyStore{
		Creator:         creator,
		CosmosPublicKey: cosmosPubHex,
		MinaPublicKey:   newMinaPubHex,
	}

	// call UpdateKeyStore and expect no error
	_, err = srv.UpdateKeyStore(ctx, msg)
	require.NoError(t, err)

	// verify updated data in store
	updated, found := k.GetKeyStore(ctx, cosmosPubHex)
	require.True(t, found)
	// compare hex strings
	require.Equal(t, newMinaPubHex, updated.MinaPublicKey)
	require.Equal(t, creator, updated.Creator)
}
*/
