package keeper

import (
	"encoding/hex"
	"errors"
	"math/big"

	sdk "github.com/cosmos/cosmos-sdk/types"
	"github.com/node101-io/mina-signer-go/constants"
	"github.com/node101-io/mina-signer-go/field"
	"github.com/node101-io/mina-signer-go/hashgeneric"
	"github.com/node101-io/mina-signer-go/keys"
	"github.com/node101-io/mina-signer-go/poseidon"

	"github.com/node101-io/pulsar/chain/x/bridge/types"
)

// UpdateHash updates a hash by combining it with an action
// Implementation: Hash(currentHash, action)
func (k Keeper) UpdateHash(ctx sdk.Context, currentHash string, action types.PulsarAction) (string, error) {

	// Initialize poseidon hash and hash helpers
	poseidon := poseidon.CreatePoseidon(*field.Fp, constants.PoseidonParamsKimchiFp)
	helper := hashgeneric.CreateHashHelpers(field.Fp, poseidon)

	var input []*big.Int

	switch action.ActionType {
	case "deposit":
		input = append(input, big.NewInt(1))
		ctx.Logger().Info("UpdateHash: deposit action")
	case "withdrawal":
		input = append(input, big.NewInt(2))
		ctx.Logger().Info("UpdateHash: withdrawal action")
	case "settlement":
		ctx.Logger().Info("UpdateHash: settlement action")
		input = append(input, big.NewInt(3))
	default:
		return currentHash, errors.New("UpdateHash: invalid action type")
	}

	var publicKey keys.PublicKey
	publicKey, err := publicKey.FromAddress(action.PublicKey)
	if err != nil {
		return currentHash, err
	}

	input = append(input, publicKey.X)
	if publicKey.IsOdd {
		input = append(input, big.NewInt(1))
	} else {
		input = append(input, big.NewInt(0))
	}

	input = append(input, big.NewInt(0).SetBytes([]byte(action.Amount.String())))

	if action.CosmosAddress != "" {
		input = append(input, big.NewInt(0).SetBytes([]byte(action.CosmosAddress)))
	} else {
		input = append(input, big.NewInt(0))
	}

	if action.CosmosSignature != "" {
		// Decode cosmos signature from hex
		cosmosSignature, err := hex.DecodeString(action.CosmosSignature)
		if err != nil {
			return currentHash, err
		}

		sigR := cosmosSignature[:32]
		sigS := cosmosSignature[32:]
		input = append(input, big.NewInt(0).SetBytes(sigR))
		input = append(input, big.NewInt(0).SetBytes(sigS))

	} else {
		input = append(input, big.NewInt(0))
		input = append(input, big.NewInt(0))
	}

	hashofAction := poseidon.Hash(input)

	currentHashBytes, _ := hex.DecodeString(currentHash)

	input = []*big.Int{
		big.NewInt(0).SetBytes(currentHashBytes),
		hashofAction,
	}

	newHash := helper.HashWithPrefix(types.HashPrefix, input)

	return hex.EncodeToString(newHash.Bytes()), nil
}

// InitializeHash creates an initial hash for empty state
func (k Keeper) InitializeHash() string {
	initHash, _ := big.NewInt(0).SetString(types.EmptyMerkleListRoot, 10)
	return hex.EncodeToString(initHash.Bytes())
}
