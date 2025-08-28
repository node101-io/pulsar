package app

import (
	minakeys "github.com/node101-io/pulsar/chain/interchain-security/v5/x/minakeys/keeper"

	"github.com/cosmos/cosmos-sdk/baseapp"
	sdk "github.com/cosmos/cosmos-sdk/types"
)

type (
	// VoteExtensionHandler defines a dummy vote extension handler for SimApp.
	//
	// NOTE: This implementation is solely used for testing purposes. DO NOT use
	// in a production application!
	VoteExtensionHandler struct {
		minaVoteExtHandler *minakeys.VoteExtHandler
	}

	// VoteExtension defines the structure used to create a dummy vote extension.
	VoteExtension struct {
		Hash   []byte
		Height int64
		Data   []byte
	}
)

func NewVoteExtensionHandler(minaVoteExtHandler *minakeys.VoteExtHandler) *VoteExtensionHandler {
	return &VoteExtensionHandler{
		minaVoteExtHandler: minaVoteExtHandler,
	}
}

func (h *VoteExtensionHandler) SetHandlers(bApp *baseapp.BaseApp) {
	bApp.SetExtendVoteHandler(h.ExtendVote())
	bApp.SetVerifyVoteExtensionHandler(h.VerifyVoteExtension())
}

func (h *VoteExtensionHandler) ExtendVote() sdk.ExtendVoteHandler {
	return h.minaVoteExtHandler.ExtendVoteHandler()
	/* return func(_ sdk.Context, req *abci.RequestExtendVote) (*abci.ResponseExtendVote, error) {
		buf := make([]byte, 1024)

		_, err := rand.Read(buf)
		if err != nil {
			return nil, fmt.Errorf("failed to generate random vote extension data: %w", err)
		}

		ve := VoteExtension{
			Hash:   req.Hash,
			Height: req.Height,
			Data:   buf,
		}

		bz, err := json.Marshal(ve)
		if err != nil {
			return nil, fmt.Errorf("failed to encode vote extension: %w", err)
		}

		return &abci.ResponseExtendVote{VoteExtension: bz}, nil
	} */
}

func (h *VoteExtensionHandler) VerifyVoteExtension() sdk.VerifyVoteExtensionHandler {
	/* return func(ctx sdk.Context, req *abci.RequestVerifyVoteExtension) (*abci.ResponseVerifyVoteExtension, error) {
		var ve VoteExtension

		if err := json.Unmarshal(req.VoteExtension, &ve); err != nil {
			return &abci.ResponseVerifyVoteExtension{Status: abci.ResponseVerifyVoteExtension_REJECT}, nil
		}

		switch {
		case req.Height != ve.Height:
			return &abci.ResponseVerifyVoteExtension{Status: abci.ResponseVerifyVoteExtension_REJECT}, nil

		case !bytes.Equal(req.Hash, ve.Hash):
			return &abci.ResponseVerifyVoteExtension{Status: abci.ResponseVerifyVoteExtension_REJECT}, nil

		case len(ve.Data) != 1024:
			return &abci.ResponseVerifyVoteExtension{Status: abci.ResponseVerifyVoteExtension_REJECT}, nil
		}

		return &abci.ResponseVerifyVoteExtension{Status: abci.ResponseVerifyVoteExtension_ACCEPT}, nil
	} */

	return h.minaVoteExtHandler.VerifyVoteExtensionHandler()
}
