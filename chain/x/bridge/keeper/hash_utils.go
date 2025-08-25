package keeper

import (
	"encoding/hex"
	"math/big"
	"strconv"

	"github.com/node101-io/mina-signer-go/constants"
	"github.com/node101-io/mina-signer-go/field"
	"github.com/node101-io/mina-signer-go/hashgeneric"
	"github.com/node101-io/mina-signer-go/poseidon"

	"github.com/cosmos/interchain-security/v5/x/bridge/types"
)

// UpdateHash updates a hash by combining it with an action
// Implementation: Hash(currentHash, action)
func (k Keeper) UpdateHash(currentHash string, action types.PulsarAction) string {

	// Initialize poseidon hash and hash helpers
	poseidon := poseidon.CreatePoseidon(*field.Fp, constants.PoseidonParamsKimchiFp)
	helper := hashgeneric.CreateHashHelpers(field.Fp, poseidon)

	input := []*big.Int{
		big.NewInt(0).SetBytes([]byte(action.PublicKey)),
		big.NewInt(0).SetBytes([]byte(action.Amount.String())),
		big.NewInt(0).SetBytes([]byte(action.ActionType)),
		big.NewInt(0).SetBytes([]byte(strconv.FormatInt(int64(action.BlockHeight), 10))),
	}

	hashofAction := poseidon.Hash(input)

	currentHashBytes, _ := hex.DecodeString(currentHash)

	input = []*big.Int{
		big.NewInt(0).SetBytes(currentHashBytes),
		hashofAction,
	}

	newHash := helper.HashWithPrefix(types.HashPrefix, input)

	return hex.EncodeToString(newHash.Bytes())
}

// InitializeHash creates an initial hash for empty state
func (k Keeper) InitializeHash() string {
	initHash, _ := big.NewInt(0).SetString(types.EmptyMerkleListRoot, 10)
	return hex.EncodeToString(initHash.Bytes())
}
