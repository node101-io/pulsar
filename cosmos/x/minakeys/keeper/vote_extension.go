package keeper

import (
	"encoding/hex"
	"encoding/json"
	"fmt"

	"github.com/coinbase/kryptology/pkg/signatures/schnorr/mina"
	abci "github.com/cometbft/cometbft/abci/types"
	sdk "github.com/cosmos/cosmos-sdk/types"
)

type MinaSignatureVoteExt struct {
	Signature []byte
}

type VoteExtHandler struct {
	Keeper Keeper
}

func (h *VoteExtHandler) ExtendVoteHandler() sdk.ExtendVoteHandler {
	return func(ctx sdk.Context, req *abci.RequestExtendVote) (*abci.ResponseExtendVote, error) {
		latestBlockHash := req.GetHash()
		encodedBlockHash := hex.EncodeToString(latestBlockHash)

		secKey := h.Keeper.secondaryKey.SecretKey
		signature, err := secKey.SignMessage(encodedBlockHash)

		if err != nil {
			return nil, fmt.Errorf("failed to sign message: %w", err)
		}

		sigBytes, err := signature.MarshalBinary()
		if err != nil {
			return nil, fmt.Errorf("failed to marshal signature: %w", err)
		}

		voteExt := MinaSignatureVoteExt{
			Signature: sigBytes,
		}

		bz, err := json.Marshal(voteExt)
		if err != nil {
			return nil, fmt.Errorf("failed to marshal vote extension: %w", err)
		}

		return &abci.ResponseExtendVote{VoteExtension: bz}, nil
	}
}

func (h *VoteExtHandler) VerifyVoteExtensionHandler() sdk.VerifyVoteExtensionHandler {
	return func(ctx sdk.Context, req *abci.RequestVerifyVoteExtension) (*abci.ResponseVerifyVoteExtension, error) {
		// Unmarshal the extension payload
		var voteExt MinaSignatureVoteExt
		if err := json.Unmarshal(req.VoteExtension, &voteExt); err != nil {
			return &abci.ResponseVerifyVoteExtension{
				Status: abci.ResponseVerifyVoteExtension_REJECT,
			}, fmt.Errorf("unmarshal vote extension: %w", err)
		}

		// Recompute the exact message that was signed (hex of block hash)
		hash := req.GetHash()
		hexMsg := hex.EncodeToString(hash)

		// Get the validator address from the request
		consAddrStr := sdk.ConsAddress(req.ValidatorAddress).String()

		// Lookup that operator’s secondary‐pubkey in your keeper
		keyStore, found := h.Keeper.GetKeyStore(ctx, consAddrStr)
		if !found {
			return &abci.ResponseVerifyVoteExtension{
				Status: abci.ResponseVerifyVoteExtension_REJECT,
			}, nil
		}
		pub := keyStore.MinaPublicKey

		// Unmarshal the raw public key bytes
		pubBytes, err := hex.DecodeString(pub)
		if err != nil {
			return &abci.ResponseVerifyVoteExtension{
				Status: abci.ResponseVerifyVoteExtension_REJECT,
			}, fmt.Errorf("decode public key: %w", err)
		}

		// Unmarshal the raw public key bytes
		pubKey := new(mina.PublicKey)
		if err := pubKey.UnmarshalBinary(pubBytes); err != nil {
			return &abci.ResponseVerifyVoteExtension{
				Status: abci.ResponseVerifyVoteExtension_REJECT,
			}, fmt.Errorf("unmarshal public key: %w", err)
		}

		// Unmarshal the raw signature bytes
		sig := new(mina.Signature)
		if err := sig.UnmarshalBinary(voteExt.Signature); err != nil {
			return &abci.ResponseVerifyVoteExtension{
				Status: abci.ResponseVerifyVoteExtension_REJECT,
			}, fmt.Errorf("unmarshal signature: %w", err)
		}

		// Run your verify routine (you fill in the details)
		if err := pubKey.VerifyMessage(sig, hexMsg); err == nil {
			return &abci.ResponseVerifyVoteExtension{
				Status: abci.ResponseVerifyVoteExtension_ACCEPT,
			}, nil
		}

		return &abci.ResponseVerifyVoteExtension{
			Status: abci.ResponseVerifyVoteExtension_REJECT,
		}, nil
	}
}
