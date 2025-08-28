package minakeys

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"strings"

	"cosmossdk.io/core/appmodule"
	"cosmossdk.io/core/store"
	"cosmossdk.io/depinject"
	"cosmossdk.io/log"
	"github.com/cosmos/cosmos-sdk/client"
	"github.com/cosmos/cosmos-sdk/codec"
	cdctypes "github.com/cosmos/cosmos-sdk/codec/types"
	servertypes "github.com/cosmos/cosmos-sdk/server/types"
	sdk "github.com/cosmos/cosmos-sdk/types"
	"github.com/cosmos/cosmos-sdk/types/module"
	authtypes "github.com/cosmos/cosmos-sdk/x/auth/types"
	govtypes "github.com/cosmos/cosmos-sdk/x/gov/types"
	"github.com/grpc-ecosystem/grpc-gateway/runtime"
	"github.com/spf13/viper"

	// this line is used by starport scaffolding # 1

	modulev1 "github.com/node101-io/pulsar/chain/interchain-security/v5/api/cosmos/minakeys/module"
	"github.com/node101-io/pulsar/chain/interchain-security/v5/x/minakeys/keeper"
	"github.com/node101-io/pulsar/chain/interchain-security/v5/x/minakeys/types"
	"github.com/node101-io/pulsar/chain/interchain-security/v5/x/minakeys/utils"
)

var (
	_ module.AppModuleBasic      = (*AppModule)(nil)
	_ module.AppModuleSimulation = (*AppModule)(nil)
	_ module.HasGenesis          = (*AppModule)(nil)
	_ module.HasInvariants       = (*AppModule)(nil)
	_ module.HasConsensusVersion = (*AppModule)(nil)

	_ appmodule.AppModule       = (*AppModule)(nil)
	_ appmodule.HasBeginBlocker = (*AppModule)(nil)
	_ appmodule.HasEndBlocker   = (*AppModule)(nil)
)

// ----------------------------------------------------------------------------
// AppModuleBasic
// ----------------------------------------------------------------------------

// AppModuleBasic implements the AppModuleBasic interface that defines the
// independent methods a Cosmos SDK module needs to implement.
type AppModuleBasic struct {
	cdc codec.BinaryCodec
}

func NewAppModuleBasic(cdc codec.BinaryCodec) AppModuleBasic {
	return AppModuleBasic{cdc: cdc}
}

// Name returns the name of the module as a string.
func (AppModuleBasic) Name() string {
	return types.ModuleName
}

// RegisterLegacyAminoCodec registers the amino codec for the module, which is used
// to marshal and unmarshal structs to/from []byte in order to persist them in the module's KVStore.
func (AppModuleBasic) RegisterLegacyAminoCodec(cdc *codec.LegacyAmino) {}

// RegisterInterfaces registers a module's interface types and their concrete implementations as proto.Message.
func (a AppModuleBasic) RegisterInterfaces(reg cdctypes.InterfaceRegistry) {
	types.RegisterInterfaces(reg)
}

// DefaultGenesis returns a default GenesisState for the module, marshalled to json.RawMessage.
// The default GenesisState need to be defined by the module developer and is primarily used for testing.
func (AppModuleBasic) DefaultGenesis(cdc codec.JSONCodec) json.RawMessage {
	return cdc.MustMarshalJSON(types.DefaultGenesis())
}

// ValidateGenesis used to validate the GenesisState, given in its json.RawMessage form.
func (AppModuleBasic) ValidateGenesis(cdc codec.JSONCodec, config client.TxEncodingConfig, bz json.RawMessage) error {
	var genState types.GenesisState
	if err := cdc.UnmarshalJSON(bz, &genState); err != nil {
		return fmt.Errorf("failed to unmarshal %s genesis state: %w", types.ModuleName, err)
	}
	return genState.Validate()
}

// RegisterGRPCGatewayRoutes registers the gRPC Gateway routes for the module.
func (AppModuleBasic) RegisterGRPCGatewayRoutes(clientCtx client.Context, mux *runtime.ServeMux) {
	if err := types.RegisterQueryHandlerClient(context.Background(), mux, types.NewQueryClient(clientCtx)); err != nil {
		panic(err)
	}
}

// ----------------------------------------------------------------------------
// AppModule
// ----------------------------------------------------------------------------

// AppModule implements the AppModule interface that defines the inter-dependent methods that modules need to implement
type AppModule struct {
	AppModuleBasic

	keeper        keeper.Keeper
	accountKeeper types.AccountKeeper
	bankKeeper    types.BankKeeper
}

func NewAppModule(
	cdc codec.Codec,
	keeper keeper.Keeper,
	accountKeeper types.AccountKeeper,
	bankKeeper types.BankKeeper,
) AppModule {
	return AppModule{
		AppModuleBasic: NewAppModuleBasic(cdc),
		keeper:         keeper,
		accountKeeper:  accountKeeper,
		bankKeeper:     bankKeeper,
	}
}

// RegisterServices registers a gRPC query service to respond to the module-specific gRPC queries
func (am AppModule) RegisterServices(cfg module.Configurator) {
	types.RegisterMsgServer(cfg.MsgServer(), keeper.NewMsgServerImpl(am.keeper))
	types.RegisterQueryServer(cfg.QueryServer(), am.keeper)
}

// RegisterInvariants registers the invariants of the module. If an invariant deviates from its predicted value, the InvariantRegistry triggers appropriate logic (most often the chain will be halted)
func (am AppModule) RegisterInvariants(_ sdk.InvariantRegistry) {}

// InitGenesis performs the module's genesis initialization. It returns no validator updates.
func (am AppModule) InitGenesis(ctx sdk.Context, cdc codec.JSONCodec, gs json.RawMessage) {
	var genState types.GenesisState
	// Initialize global index to index in genesis state
	cdc.MustUnmarshalJSON(gs, &genState)

	InitGenesis(ctx, am.keeper, genState)
}

// ExportGenesis returns the module's exported genesis state as raw JSON bytes.
func (am AppModule) ExportGenesis(ctx sdk.Context, cdc codec.JSONCodec) json.RawMessage {
	genState := ExportGenesis(ctx, am.keeper)
	return cdc.MustMarshalJSON(genState)
}

// ConsensusVersion is a sequence number for state-breaking change of the module.
// It should be incremented on each consensus-breaking change introduced by the module.
// To avoid wrong/empty versions, the initial version should be set to 1.
func (AppModule) ConsensusVersion() uint64 { return 1 }

// BeginBlock contains the logic that is automatically triggered at the beginning of each block.
// The begin block implementation is optional.
func (am AppModule) BeginBlock(_ context.Context) error {
	return nil
}

// EndBlock contains the logic that is automatically triggered at the end of each block.
// The end block implementation is optional.
func (am AppModule) EndBlock(_ context.Context) error {
	return nil
}

// IsOnePerModuleType implements the depinject.OnePerModuleType interface.
func (am AppModule) IsOnePerModuleType() {}

// IsAppModule implements the appmodule.AppModule interface.
func (am AppModule) IsAppModule() {}

// ----------------------------------------------------------------------------
// App Wiring Setup
// ----------------------------------------------------------------------------

func init() {
	appmodule.Register(
		&modulev1.Module{},
		appmodule.Provide(
			ProvideModule,
			ProvideSecondaryKey,
		),
	)
}

type SecondaryKeyInputs struct {
	depinject.In

	Config  *modulev1.Module
	Logger  log.Logger
	AppOpts servertypes.AppOptions `optional:"true"`
}

type SecondaryKeyOutputs struct {
	depinject.Out

	SecondaryKey *types.SecondaryKey
}

// readAppTomlConfig attempts to read minakeys configuration from app.toml file
func readAppTomlConfig(logger log.Logger) (string, string) {
	var secondaryKeyHex, secondaryKeyPath string

	// Try to find app.toml in common locations
	possiblePaths := []string{
		//"config/app.toml", // relative to home
		"app.toml", // relative to current dir
		//"/home/littlehatboy/.cosmos/config/app.toml", // absolute path for testing
	}

	// Also try home directory if available
	/* if home, err := os.UserHomeDir(); err == nil {
		possiblePaths = append(possiblePaths, filepath.Join(home, ".cosmos", "config", "app.toml"))
	} */

	for _, configPath := range possiblePaths {
		logger.Info("Trying to read app.toml", "path", configPath)

		v := viper.New()
		v.SetConfigFile(configPath)
		v.SetConfigType("toml")

		if err := v.ReadInConfig(); err != nil {
			logger.Info("Could not read config file", "path", configPath, "error", err)
			continue
		}

		// Successfully read config file
		logger.Info("Successfully read app.toml", "path", configPath)

		secondaryKeyHex = v.GetString("minakeys.secondary_key_hex")
		secondaryKeyPath = v.GetString("minakeys.secondary_key_path")

		logger.Info("Read config values",
			"secondary_key_hex_length", len(secondaryKeyHex),
			"secondary_key_path", secondaryKeyPath)

		if secondaryKeyHex != "" || secondaryKeyPath != "" {
			return secondaryKeyHex, secondaryKeyPath
		}
	}

	logger.Info("No app.toml found or no minakeys configuration in app.toml")
	return "", ""
}

func ProvideSecondaryKey(in SecondaryKeyInputs) (SecondaryKeyOutputs, error) {
	var hexStr string
	var err error

	// Debug: Log what we received in the config
	in.Logger.Info("ProvideSecondaryKey called",
		"config_is_nil", in.Config == nil,
		"app_opts_is_nil", in.AppOpts == nil)

	// log the appOpts
	in.Logger.Info("AppOpts", "appOpts", in.AppOpts)
	// log the config
	in.Logger.Info("Config", "config", in.Config)

	// Priority 1: Try to read from app.toml directly
	hexFromToml, pathFromToml := readAppTomlConfig(in.Logger)
	if hexFromToml != "" {
		hexStr = strings.TrimSpace(hexFromToml)
		in.Logger.Info("Using secondary key hex from app.toml")
	} else if pathFromToml != "" {
		data, err := os.ReadFile(pathFromToml)
		if err != nil {
			return SecondaryKeyOutputs{}, fmt.Errorf("failed to read secondary key from app.toml path %s: %w", pathFromToml, err)
		}
		hexStr = strings.TrimSpace(string(data))
		in.Logger.Info("Using secondary key from app.toml file path", "path", pathFromToml)
	}

	// Priority 2: Try to read from app.toml via AppOptions (if direct reading didn't work)
	if hexStr == "" && in.AppOpts != nil {
		in.Logger.Info("Direct app.toml reading didn't work, trying AppOpts")

		// Try secondary_key_hex first
		hexFromAppToml := in.AppOpts.Get("minakeys.secondary_key_hex")
		in.Logger.Info("Checking minakeys.secondary_key_hex from app.toml",
			"value_is_nil", hexFromAppToml == nil,
			"value", hexFromAppToml)

		if hexFromAppToml != nil {
			if hexValue, ok := hexFromAppToml.(string); ok && hexValue != "" {
				hexStr = strings.TrimSpace(hexValue)
				in.Logger.Info("Using secondary key hex from app.toml via AppOpts")
			} else {
				in.Logger.Info("secondary_key_hex from app.toml is not a valid string", "type", fmt.Sprintf("%T", hexFromAppToml))
			}
		}

		// If no hex, try secondary_key_path from app.toml
		if hexStr == "" {
			pathFromAppToml := in.AppOpts.Get("minakeys.secondary_key_path")
			in.Logger.Info("Checking minakeys.secondary_key_path from app.toml",
				"value_is_nil", pathFromAppToml == nil,
				"value", pathFromAppToml)

			if pathFromAppToml != nil {
				if pathValue, ok := pathFromAppToml.(string); ok && pathValue != "" {
					data, err := os.ReadFile(pathValue)
					if err != nil {
						return SecondaryKeyOutputs{}, fmt.Errorf("failed to read secondary key from app.toml path %s: %w", pathValue, err)
					}
					hexStr = strings.TrimSpace(string(data))
					in.Logger.Info("Using secondary key from app.toml file path via AppOpts", "path", pathValue)
				} else {
					in.Logger.Info("secondary_key_path from app.toml is not a valid string", "type", fmt.Sprintf("%T", pathFromAppToml))
				}
			}
		}
	} else if hexStr == "" {
		in.Logger.Info("AppOpts is nil, cannot read from app.toml via AppOpts")
	}

	// Priority 3: Fallback to module config (for programmatic configuration)
	if hexStr == "" && in.Config != nil {
		in.Logger.Info("Fallback to module config")
		if in.Config.SecondaryKeyHex != "" {
			hexStr = strings.TrimSpace(in.Config.SecondaryKeyHex)
			in.Logger.Info("Using secondary key hex from module config")
		} else if in.Config.SecondaryKeyPath != "" {
			data, err := os.ReadFile(in.Config.SecondaryKeyPath)
			if err != nil {
				return SecondaryKeyOutputs{}, fmt.Errorf("failed to read %s: %w", in.Config.SecondaryKeyPath, err)
			}
			hexStr = strings.TrimSpace(string(data))
			in.Logger.Info("Using secondary key from module config path", "path", in.Config.SecondaryKeyPath)
		}
	}

	// If still no configuration found, return error
	if hexStr == "" {
		return SecondaryKeyOutputs{}, fmt.Errorf("no secondary key configuration provided: check app.toml [minakeys] section, module config, or %s/.secondary_key.toml", os.Getenv("HOME"))
	}

	in.Logger.Info("Hex string of secondary key", "hexStr", hexStr)

	// decode and unmarshal the hex-string into a SecondaryKey
	secondaryKey, err := utils.LoadSecondaryKeyFromHex(hexStr, in.Logger)
	if err != nil {
		in.Logger.Error("Failed to load secondary key", "error", err)
		return SecondaryKeyOutputs{}, err
	}

	in.Logger.Info("Secondary key loaded successfully")

	return SecondaryKeyOutputs{SecondaryKey: secondaryKey}, nil
}

type ModuleInputs struct {
	depinject.In

	StoreService store.KVStoreService
	Cdc          codec.Codec
	Config       *modulev1.Module
	Logger       log.Logger

	AccountKeeper types.AccountKeeper
	BankKeeper    types.BankKeeper

	SecondaryKey *types.SecondaryKey
}

type ModuleOutputs struct {
	depinject.Out

	MinakeysKeeper keeper.Keeper
	Module         appmodule.AppModule
}

func ProvideModule(in ModuleInputs) ModuleOutputs {
	// default to governance authority if not provided
	authority := authtypes.NewModuleAddress(govtypes.ModuleName)
	if in.Config.Authority != "" {
		authority = authtypes.NewModuleAddressOrBech32Address(in.Config.Authority)
	}
	k := keeper.NewKeeper(
		in.Cdc,
		in.StoreService,
		in.Logger,
		authority.String(),
		in.SecondaryKey,
	)
	m := NewAppModule(
		in.Cdc,
		k,
		in.AccountKeeper,
		in.BankKeeper,
	)

	return ModuleOutputs{MinakeysKeeper: k, Module: m}
}
