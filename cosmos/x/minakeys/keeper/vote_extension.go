package keeper

import (
	"encoding/hex"
	"encoding/json"
	"fmt"
	"sync"

	"github.com/coinbase/kryptology/pkg/signatures/schnorr/mina"
	abci "github.com/cometbft/cometbft/abci/types"
	sdk "github.com/cosmos/cosmos-sdk/types"
)

type MinaSignatureVoteExt struct {
	BlockHash []byte
	Signature []byte
}

type VoteExtHandler struct {
	Keeper Keeper

	mu    sync.RWMutex
	votes map[uint64]map[string][]byte // height -> consAddr -> extension bytes
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
			BlockHash: latestBlockHash,
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
			return &abci.ResponseVerifyVoteExtension{Status: abci.ResponseVerifyVoteExtension_REJECT}, nil
		}

		// Recompute the exact message that was signed (hex of block hash)
		hexMsg := hex.EncodeToString(req.GetHash())

		consAddrStr := sdk.ConsAddress(req.ValidatorAddress).String()

		keyStore, found := h.Keeper.GetKeyStore(ctx, consAddrStr)
		if !found {
			// unknown validator in our local map – ignore the vote.
			return &abci.ResponseVerifyVoteExtension{Status: abci.ResponseVerifyVoteExtension_REJECT}, nil
		}

		pubBytes, err := hex.DecodeString(keyStore.MinaPublicKey)
		if err != nil {
			return &abci.ResponseVerifyVoteExtension{Status: abci.ResponseVerifyVoteExtension_REJECT}, nil
		}

		pubKey := new(mina.PublicKey)
		if err := pubKey.UnmarshalBinary(pubBytes); err != nil {
			return &abci.ResponseVerifyVoteExtension{Status: abci.ResponseVerifyVoteExtension_REJECT}, nil
		}

		sig := new(mina.Signature)
		if err := sig.UnmarshalBinary(voteExt.Signature); err != nil {
			return &abci.ResponseVerifyVoteExtension{Status: abci.ResponseVerifyVoteExtension_REJECT}, nil
		}

		// Verify signature; if ok, keep the vote in memory.
		if err := pubKey.VerifyMessage(sig, hexMsg); err == nil {
			h.storeVote(uint64(req.GetHeight()), consAddrStr, req.VoteExtension)
		}

		return &abci.ResponseVerifyVoteExtension{Status: abci.ResponseVerifyVoteExtension_ACCEPT}, nil
	}
}

// storeVote saves the extension in-memory for later proposal processing.
func (h *VoteExtHandler) storeVote(height uint64, consAddr string, ext []byte) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.votes == nil {
		h.votes = make(map[uint64]map[string][]byte)
	}
	if _, ok := h.votes[height]; !ok {
		h.votes[height] = make(map[string][]byte)
	}
	h.votes[height][consAddr] = ext
}

// fetchVotes returns a COPY of the map for the given height.
func (h *VoteExtHandler) fetchVotes(height uint64) map[string][]byte {
	h.mu.RLock()
	defer h.mu.RUnlock()
	res := make(map[string][]byte)
	if m, ok := h.votes[height]; ok {
		for k, v := range m {
			res[k] = v
		}
	}
	return res
}

// deleteVotes removes all saved votes for the given height.
func (h *VoteExtHandler) deleteVotes(height uint64) {
	h.mu.Lock()
	defer h.mu.Unlock()
	delete(h.votes, height)
}

// PrepareProposalHandler injects the collected vote-extensions (for height-1)
// as the very first transaction of the proposal block.
// A simple JSON payload prefixed by "VOTEEXT:" is used; this is *not* part of
// consensus state and will be verified by ProcessProposal on peers.
func (h *VoteExtHandler) PrepareProposalHandler() sdk.PrepareProposalHandler {
	type payload struct {
		Height uint64            `json:"height"`
		Votes  map[string][]byte `json:"votes"`
	}

	return func(ctx sdk.Context, req *abci.RequestPrepareProposal) (*abci.ResponsePrepareProposal, error) {
		// vote-extensions for previous height (H-1)
		targetHeight := uint64(req.GetHeight() - 1)
		votes := h.fetchVotes(targetHeight)
		if len(votes) == 0 {
			return &abci.ResponsePrepareProposal{Txs: req.Txs}, nil
		}

		pl := payload{Height: targetHeight, Votes: votes}
		bz, err := json.Marshal(pl)
		if err != nil {
			return nil, fmt.Errorf("marshal payload: %w", err)
		}

		// prefix makes it easier to identify the vote extension
		marker := []byte("VOTEEXT:")
		extTx := append(marker, bz...)

		// prepend to existing txs
		txs := make([][]byte, 0, len(req.Txs)+1)
		txs = append(txs, extTx)
		txs = append(txs, req.Txs...)

		return &abci.ResponsePrepareProposal{Txs: txs}, nil
	}
}

// ProcessProposalHandler checks that the proposer included ≥⅔ voting-power worth
// of vote-extensions for the previous height. If not, the proposal is rejected.
// NOTE: Voting-power calculation is simplified; adjust as needed.
func (h *VoteExtHandler) ProcessProposalHandler() sdk.ProcessProposalHandler {
	type payload struct {
		Height uint64            `json:"height"`
		Votes  map[string][]byte `json:"votes"`
	}

	return func(ctx sdk.Context, req *abci.RequestProcessProposal) (*abci.ResponseProcessProposal, error) {
		marker := []byte("VOTEEXT:")
		var data payload
		txs := req.GetTxs()
		if len(txs) == 0 || len(txs[0]) <= len(marker) || string(txs[0][:len(marker)]) != string(marker) {
			return &abci.ResponseProcessProposal{Status: abci.ResponseProcessProposal_REJECT}, nil
		}

		if err := json.Unmarshal(txs[0][len(marker):], &data); err != nil {
			return &abci.ResponseProcessProposal{Status: abci.ResponseProcessProposal_REJECT}, nil
		}

		// Compute total voting power and power represented by included vote-extensions.
		totalPower := int64(0)
		includedPower := int64(0)

		commitInfo := req.GetProposedLastCommit()
		for _, v := range commitInfo.Votes {
			valAddr := sdk.ConsAddress(v.Validator.Address).String()
			power := v.Validator.Power
			totalPower += power

			if _, ok := data.Votes[valAddr]; ok {
				includedPower += power
			}
		}

		// If no voting power present (should not happen), reject.
		if totalPower == 0 {
			return &abci.ResponseProcessProposal{Status: abci.ResponseProcessProposal_REJECT}, nil
		}

		// Check ≥2/3 condition: includedPower * 3 >= totalPower * 2
		if includedPower*3 < totalPower*2 {
			return &abci.ResponseProcessProposal{Status: abci.ResponseProcessProposal_REJECT}, nil
		}

		// Clean up cache once proposal accepted.
		h.deleteVotes(data.Height)

		return &abci.ResponseProcessProposal{Status: abci.ResponseProcessProposal_ACCEPT}, nil
	}
}
