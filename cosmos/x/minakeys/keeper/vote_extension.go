package keeper

import (
	"encoding/hex"
	"encoding/json"
	"fmt"
	"sync"

	abci "github.com/cometbft/cometbft/abci/types"
	sdk "github.com/cosmos/cosmos-sdk/types"
	"github.com/node101-io/mina-signer-go/keys"
	"github.com/node101-io/mina-signer-go/signature"

	minakeystypes "github.com/node101-io/pulsar/cosmos/x/minakeys/types"
)

type MinaSignatureVoteExt struct {
	MinaAddress string `json:"mina_address"`
	BlockHash   []byte `json:"block_hash"`
	Signature   []byte `json:"signature"`
}

type VoteExtHandler struct {
	Keeper Keeper

	mu    sync.RWMutex
	votes map[uint64]map[string][]byte // height -> consAddr -> extension bytes
}

func (h *VoteExtHandler) ExtendVoteHandler() sdk.ExtendVoteHandler {
	return func(ctx sdk.Context, req *abci.RequestExtendVote) (*abci.ResponseExtendVote, error) {
		ctx.Logger().Info("ExtendVoteHandler", "height", req.GetHeight())
		latestBlockHash := req.GetHash()
		encodedBlockHash := hex.EncodeToString(latestBlockHash)

		secKey := h.Keeper.secondaryKey.SecretKey

		signature, err := secKey.SignMessage(encodedBlockHash, minakeystypes.DevnetNetworkID)
		ctx.Logger().Info("Signed block hash with secondary private key", "signature", signature)
		if err != nil {
			return nil, fmt.Errorf("failed to sign message: %w", err)
		}

		sigBytes, err := signature.MarshalBytes()
		if err != nil {
			return nil, fmt.Errorf("failed to marshal signature: %w", err)
		}

		addr, err := h.Keeper.secondaryKey.PublicKey.ToAddress()
		if err != nil {
			return nil, fmt.Errorf("failed to convert public key to address: %w", err)
		}

		voteExt := MinaSignatureVoteExt{
			MinaAddress: addr,
			BlockHash:   latestBlockHash,
			Signature:   sigBytes,
		}
		ctx.Logger().Info("Vote extension for block", "voteExt", voteExt)

		bz, err := json.Marshal(voteExt)
		if err != nil {
			return nil, fmt.Errorf("failed to marshal vote extension: %w", err)
		}

		// Store vote extension in memory
		h.storeVote(uint64(req.GetHeight()), voteExt.MinaAddress, bz)
		ctx.Logger().Info("Vote extension stored in memory", "height", req.GetHeight(), "validator", voteExt.MinaAddress)
		votes := h.fetchVotes(uint64(req.GetHeight()))
		// Log votes with height and validator address
		ctx.Logger().Info("Votes", "height", req.GetHeight(), "votes", votes)

		return &abci.ResponseExtendVote{VoteExtension: bz}, nil
	}
}

func (h *VoteExtHandler) VerifyVoteExtensionHandler() sdk.VerifyVoteExtensionHandler {
	return func(ctx sdk.Context, req *abci.RequestVerifyVoteExtension) (*abci.ResponseVerifyVoteExtension, error) {
		ctx.Logger().Info("VerifyVoteExtensionHandler:start", "height", req.GetHeight())
		// Unmarshal the extension payload
		var voteExt MinaSignatureVoteExt
		if err := json.Unmarshal(req.VoteExtension, &voteExt); err != nil {
			return &abci.ResponseVerifyVoteExtension{Status: abci.ResponseVerifyVoteExtension_REJECT}, fmt.Errorf("invalid vote extension payload: %w", err)
		}

		// Log incoming vote extension for visibility
		ctx.Logger().Info("incoming vote extension", "voteExt", voteExt)

		// Recompute the exact message that was signed (hex of block hash)
		hexMsg := hex.EncodeToString(req.GetHash())

		// Get the validator address from the request
		consAddrStr := sdk.ConsAddress(req.ValidatorAddress).String()

		// Log incoming vote-extension for visibility
		ctx.Logger().Info("VerifyVoteExtension", "height", req.GetHeight(), "validator", consAddrStr)

		keyStore, found := h.Keeper.GetKeyStore(ctx, consAddrStr)
		if !found {
			ctx.Logger().Info("unknown validator in our local map", "validator", consAddrStr)
			// unknown validator in our local map – ignore the vote.
			return &abci.ResponseVerifyVoteExtension{Status: abci.ResponseVerifyVoteExtension_REJECT}, fmt.Errorf("unknown validator address %s", consAddrStr)
		}

		pubKey, err := new(keys.PublicKey).FromAddress(keyStore.MinaPublicKey)
		if err != nil {
			ctx.Logger().Info("failed to unmarshal mina public key for validator", "validator", consAddrStr, "error", err)
			return &abci.ResponseVerifyVoteExtension{Status: abci.ResponseVerifyVoteExtension_REJECT}, fmt.Errorf("failed to unmarshal mina public key for validator %s: %w", consAddrStr, err)
		}

		sig := new(signature.Signature)
		if err := sig.UnmarshalBytes(voteExt.Signature); err != nil {
			ctx.Logger().Info("invalid signature encoding", "error", err)
			return &abci.ResponseVerifyVoteExtension{Status: abci.ResponseVerifyVoteExtension_REJECT}, fmt.Errorf("invalid signature encoding: %w", err)
		}

		// Check if the address is correct.
		pubKeyAddr, err := pubKey.ToAddress()
		if err != nil {
			ctx.Logger().Info("failed to convert public key to address", "validator", consAddrStr, "error", err)
			return &abci.ResponseVerifyVoteExtension{Status: abci.ResponseVerifyVoteExtension_REJECT}, fmt.Errorf("failed to convert public key to address for validator %s: %w", consAddrStr, err)
		}

		if voteExt.MinaAddress != pubKeyAddr {
			ctx.Logger().Info("validator address mismatch", "ext", voteExt.MinaAddress, "expected", pubKeyAddr)
			return &abci.ResponseVerifyVoteExtension{Status: abci.ResponseVerifyVoteExtension_REJECT}, fmt.Errorf("validator address mismatch: ext %s expected %s", voteExt.MinaAddress, pubKeyAddr)
		}

		// Verify signature; if ok, keep the vote in memory.
		if pubKey.VerifyMessage(sig, hexMsg, minakeystypes.DevnetNetworkID) {
			ctx.Logger().Info("signature verified", "validator", voteExt.MinaAddress)
			h.storeVote(uint64(req.GetHeight()), voteExt.MinaAddress, req.VoteExtension)
		}

		ctx.Logger().Info("vote extension verified", "validator", voteExt.MinaAddress)
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

// PreBlocker persists the verified vote-extensions of height H-1 into the
// on-chain KVStore (VoteExt map) so that they can be queried externally.
// After persistence, in-memory cache for that height is cleared.
func (h *VoteExtHandler) PreBlocker() sdk.PreBlocker {
	return func(ctx sdk.Context, req *abci.RequestFinalizeBlock) (*sdk.ResponsePreBlock, error) {
		ctx.Logger().Info("PreBlocker:start", "height", req.GetHeight())

		// If height is 1, we won't have any votes thus skip the proposal
		if req.GetHeight() == 1 {
			ctx.Logger().Info("Height is 1, skipping proposal", "height", req.GetHeight())
			return &sdk.ResponsePreBlock{}, nil
		}

		targetHeight := uint64(req.GetHeight() - 1)
		votes := h.fetchVotes(targetHeight)
		if len(votes) == 0 {
			// log no votes
			ctx.Logger().Info("No votes", "height", targetHeight)
			return &sdk.ResponsePreBlock{}, nil
		}

		ctx.Logger().Info("PreBlocker", "persistHeight", targetHeight, "voteCount", len(votes))

		for consAddr, ext := range votes {
			var ve MinaSignatureVoteExt
			if err := json.Unmarshal(ext, &ve); err != nil {
				continue // skip malformed entry
			}

			sigHex := hex.EncodeToString(ve.Signature)
			idx := fmt.Sprintf("%d/%s", targetHeight, consAddr)

			record := minakeystypes.VoteExt{
				Index:         idx,
				Height:        targetHeight,
				ValidatorAddr: ve.MinaAddress,
				Signature:     sigHex,
			}

			h.Keeper.SetVoteExt(ctx, record)

			// Update height-based index mapping
			h.Keeper.SetVoteExtIndex(ctx, targetHeight, idx)
		}

		// clear from memory after persisting
		h.deleteVotes(targetHeight)

		return &sdk.ResponsePreBlock{}, nil
	}
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
		ctx.Logger().Info("PrepareProposalHandler:start", "height", req.GetHeight())

		// If height is 1, we won't have any votes thus skip the proposal
		if req.GetHeight() == 1 {
			ctx.Logger().Info("Height is 1, skipping proposal", "height", req.GetHeight())
			return &abci.ResponsePrepareProposal{Txs: req.Txs}, nil
		}

		// vote-extensions for previous height (H-1)
		targetHeight := uint64(req.GetHeight() - 1)
		votes := h.fetchVotes(targetHeight)
		if len(votes) == 0 {
			ctx.Logger().Info("No votes for previous height, accepting proposal", "looking for", targetHeight, "proposal height", req.GetHeight())
			return &abci.ResponsePrepareProposal{Txs: req.Txs}, nil
		}

		pl := payload{Height: targetHeight, Votes: votes}
		bz, err := json.Marshal(pl)
		if err != nil {
			ctx.Logger().Info("Failed to marshal payload", "error", err)
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

// ProcessProposalHandler now enforces a lighter rule: each validator only
// checks whether _its own_ vote-extension for the previous height is included
// in the block proposal. If the validator's signature is missing, the proposal
// is rejected. This shifts the ≥⅔ voting-power requirement to CometBFT itself:
// a block that does not include ≥⅔ of the network's vote-extensions will be
// rejected automatically because fewer than ⅔ of validators will `ACCEPT` it.
func (h *VoteExtHandler) ProcessProposalHandler() sdk.ProcessProposalHandler {
	type payload struct {
		Height uint64            `json:"height"`
		Votes  map[string][]byte `json:"votes"`
	}

	return func(ctx sdk.Context, req *abci.RequestProcessProposal) (*abci.ResponseProcessProposal, error) {
		ctx.Logger().Info("ProcessProposalHandler:start", "height", req.GetHeight())

		// If height is 1, we won't have any votes thus skip the proposal
		if req.GetHeight() == 1 {
			ctx.Logger().Info("Height is 1, accepting proposal", "height", req.GetHeight())
			return &abci.ResponseProcessProposal{Status: abci.ResponseProcessProposal_ACCEPT}, nil
		}

		targetHeight := uint64(req.GetHeight() - 1)

		// If the previous height has no votes, we don't wait for the VOTEEXT tx.
		if len(h.fetchVotes(targetHeight)) == 0 {
			ctx.Logger().Info("No votes for previous height, accepting proposal", "looking for height", targetHeight, "proposal height", req.GetHeight())
			return &abci.ResponseProcessProposal{Status: abci.ResponseProcessProposal_ACCEPT}, nil
		}

		marker := []byte("VOTEEXT:")
		txs := req.GetTxs()

		// If the special transaction is missing, immediately reject.
		if len(txs) == 0 || len(txs[0]) <= len(marker) || string(txs[0][:len(marker)]) != string(marker) {
			ctx.Logger().Info("Proposal missing VOTEEXT transaction", "looking for height", targetHeight, "proposal height", req.GetHeight())
			return &abci.ResponseProcessProposal{Status: abci.ResponseProcessProposal_REJECT}, fmt.Errorf("proposal missing VOTEEXT transaction")
		}

		// Decode the payload containing vote-extensions.
		var data payload
		if err := json.Unmarshal(txs[0][len(marker):], &data); err != nil {
			ctx.Logger().Info("Malformed VOTEEXT payload", "error", err)
			return &abci.ResponseProcessProposal{Status: abci.ResponseProcessProposal_REJECT}, fmt.Errorf("malformed VOTEEXT payload: %w", err)
		}

		// Set the votes in the payload if we don't have them in our map
		for _, voteBytes := range data.Votes {
			var ve MinaSignatureVoteExt
			if err := json.Unmarshal(voteBytes, &ve); err != nil {
				continue // skip malformed entry
			}
			h.storeVote(uint64(req.GetHeight()), ve.MinaAddress, voteBytes)
		}

		// Create our address from our local Mina public key.
		myAddr, err := h.Keeper.secondaryKey.PublicKey.ToAddress()
		if err != nil {
			ctx.Logger().Info("Failed to convert public key to address", "error", err)
			return &abci.ResponseProcessProposal{Status: abci.ResponseProcessProposal_REJECT}, fmt.Errorf("failed to convert public key to address: %w", err)
		}

		// Find our address in the map.
		extBz, ok := data.Votes[myAddr]
		if !ok {
			ctx.Logger().Info("Validator's vote extension missing from proposal", "validator", myAddr)
			return &abci.ResponseProcessProposal{Status: abci.ResponseProcessProposal_REJECT}, fmt.Errorf("validator's vote extension missing from proposal")
		}

		var ve MinaSignatureVoteExt
		if err := json.Unmarshal(extBz, &ve); err != nil {
			ctx.Logger().Info("Malformed vote extension entry", "error", err)
			return &abci.ResponseProcessProposal{Status: abci.ResponseProcessProposal_REJECT}, fmt.Errorf("malformed vote extension entry: %w", err)
		}

		// Verify signature
		hexMsg := hex.EncodeToString(ve.BlockHash)
		sig := new(signature.Signature)
		if err := sig.UnmarshalBytes(ve.Signature); err != nil {
			ctx.Logger().Info("Invalid signature encoding", "error", err)
			return &abci.ResponseProcessProposal{Status: abci.ResponseProcessProposal_REJECT}, fmt.Errorf("invalid signature encoding: %w", err)
		}

		pubKey := h.Keeper.secondaryKey.PublicKey
		if !pubKey.VerifyMessage(sig, hexMsg, minakeystypes.DevnetNetworkID) {
			ctx.Logger().Info("Signature verification failed", "error", err)
			return &abci.ResponseProcessProposal{Status: abci.ResponseProcessProposal_REJECT}, fmt.Errorf("signature verification failed: %w", err)
		}

		// Everything is fine.
		return &abci.ResponseProcessProposal{Status: abci.ResponseProcessProposal_ACCEPT}, nil
	}
}
