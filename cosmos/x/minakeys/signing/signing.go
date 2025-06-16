package signing

// KeyType defines the type of the keys used (e.g., "pallas-curve").
const KeyType = "pallas-curve"

// FieldElementByteSize defines the size of a field element in bytes.
const FieldElementByteSize = 32

// Network IDs define Mina networks.
// These are standard string identifiers used by the Pulsar protocol.
const (
	MainnetNetworkID string = "Mainnet" // Identifier for the Pulsar Mainnet.
	TestnetNetworkID string = "Testnet" // Identifier for a Pulsar Testnet.
	DevnetNetworkID  string = "Devnet"  // Identifier for a Pulsar Devnet.
)
