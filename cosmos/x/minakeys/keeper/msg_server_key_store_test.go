package keeper_test

import (
	"encoding/hex"
	"strconv"
	"testing"

	ckeys "github.com/cosmos/cosmos-sdk/crypto/keys/secp256k1"
	"github.com/stretchr/testify/require"

	"github.com/coinbase/kryptology/pkg/signatures/schnorr/mina"
	keepertest "github.com/node101-io/pulsar/cosmos/testutil/keeper"
	"github.com/node101-io/pulsar/cosmos/x/minakeys/keeper"
	"github.com/node101-io/pulsar/cosmos/x/minakeys/types"
)

// Prevent strconv unused error
var _ = strconv.IntSize

func TestCreateKeyStore_Success(t *testing.T) {
	// fresh keeper+context
	k, ctx := keepertest.MinakeysKeeper(t)
	srv := keeper.NewMsgServerImpl(k)

	// --- generate Cosmos secp256k1 keypair ---
	cosmosPriv := ckeys.GenPrivKey()
	cosmosPub := cosmosPriv.PubKey().Bytes()
	cosmosPubHex := hex.EncodeToString(cosmosPub)

	// --- generate Mina schnorr keypair ---
	minaPub, minaPriv, err := mina.NewKeys()
	require.NoError(t, err)
	minaPubBytes, err := minaPub.MarshalBinary()
	require.NoError(t, err)
	minaPubHex := hex.EncodeToString(minaPubBytes)

	// --- signatures ---
	// Mina signs the Cosmos public key hex
	minaSig, err := minaPriv.SignMessage(cosmosPubHex)
	require.NoError(t, err)
	minaSigBytes, err := minaSig.MarshalBinary()
	require.NoError(t, err)

	// Cosmos signs the Mina public key hex
	cosmosSig, err := cosmosPriv.Sign([]byte(minaPubHex))
	require.NoError(t, err)

	// --- build message ---
	msg := &types.MsgCreateKeyStore{
		Creator:         "cosmos1testaddress...",
		CosmosPublicKey: cosmosPubHex,
		MinaPublicKey:   minaPubHex,
		CosmosSignature: cosmosSig,
		MinaSignature:   minaSigBytes,
	}

	// --- call CreateKeyStore with wrapped context ---
	_, err = srv.CreateKeyStore(ctx, msg)
	require.NoError(t, err)
}

func TestCreateKeyStore_DuplicateIndex(t *testing.T) {
	// fresh keeper+context
	k, ctx := keepertest.MinakeysKeeper(t)
	srv := keeper.NewMsgServerImpl(k)

	// inline valid message generation (same as success case)...
	cosmosPriv := ckeys.GenPrivKey()
	cosmosPubHex := hex.EncodeToString(cosmosPriv.PubKey().Bytes())
	minaPub, minaPriv, err := mina.NewKeys()
	require.NoError(t, err)
	minaPubHex := func() string {
		b, _ := minaPub.MarshalBinary()
		return hex.EncodeToString(b)
	}()
	minaSig, err := minaPriv.SignMessage(cosmosPubHex)
	require.NoError(t, err)
	minaSigBytes, err := minaSig.MarshalBinary()
	require.NoError(t, err)
	cosmosSig, err := cosmosPriv.Sign([]byte(minaPubHex))
	require.NoError(t, err)

	msg := &types.MsgCreateKeyStore{
		Creator:         "cosmos1testaddress...",
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
	require.Contains(t, err.Error(), "index already set")
}

func TestCreateKeyStore_InvalidCosmosSignature(t *testing.T) {
	// fresh keeper+context
	k, ctx := keepertest.MinakeysKeeper(t)
	srv := keeper.NewMsgServerImpl(k)

	// inline valid message generation...
	cosmosPriv := ckeys.GenPrivKey()
	cosmosPubHex := hex.EncodeToString(cosmosPriv.PubKey().Bytes())
	minaPub, minaPriv, err := mina.NewKeys()
	require.NoError(t, err)
	minaPubHex := func() string {
		b, _ := minaPub.MarshalBinary()
		return hex.EncodeToString(b)
	}()
	minaSig, err := minaPriv.SignMessage(cosmosPubHex)
	require.NoError(t, err)
	minaSigBytes, err := minaSig.MarshalBinary()
	require.NoError(t, err)
	cosmosSig, err := cosmosPriv.Sign([]byte(minaPubHex))
	require.NoError(t, err)

	// corrupt the cosmos signature
	cosmosSig[0] ^= 0xFF

	msg := &types.MsgCreateKeyStore{
		Creator:         "cosmos1testaddress...",
		CosmosPublicKey: cosmosPubHex,
		MinaPublicKey:   minaPubHex,
		CosmosSignature: cosmosSig,
		MinaSignature:   minaSigBytes,
	}

	// expect invalid cosmos signature error
	_, err = srv.CreateKeyStore(ctx, msg)
	require.Error(t, err)
	require.Contains(t, err.Error(), "invalid cosmos signature")
}

func TestCreateKeyStore_InvalidMinaSignature(t *testing.T) {
	// fresh keeper+context
	k, ctx := keepertest.MinakeysKeeper(t)
	srv := keeper.NewMsgServerImpl(k)

	// inline valid message generation...
	cosmosPriv := ckeys.GenPrivKey()
	cosmosPubHex := hex.EncodeToString(cosmosPriv.PubKey().Bytes())
	minaPub, minaPriv, err := mina.NewKeys()
	require.NoError(t, err)
	minaPubHex := func() string {
		b, _ := minaPub.MarshalBinary()
		return hex.EncodeToString(b)
	}()
	minaSig, err := minaPriv.SignMessage(cosmosPubHex)
	require.NoError(t, err)
	minaSigBytes, err := minaSig.MarshalBinary()
	require.NoError(t, err)
	cosmosSig, err := cosmosPriv.Sign([]byte(minaPubHex))
	require.NoError(t, err)

	// corrupt the mina signature
	badMinaSig := make([]byte, len(minaSigBytes))
	copy(badMinaSig, minaSigBytes)
	badMinaSig[0] ^= 0xFF

	msg := &types.MsgCreateKeyStore{
		Creator:         "cosmos1testaddress...",
		CosmosPublicKey: cosmosPubHex,
		MinaPublicKey:   minaPubHex,
		CosmosSignature: cosmosSig,
		MinaSignature:   badMinaSig,
	}

	// expect invalid mina signature error
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
