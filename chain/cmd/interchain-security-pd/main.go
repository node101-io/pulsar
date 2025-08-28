package main

import (
	"fmt"
	"os"

	svrcmd "github.com/cosmos/cosmos-sdk/server/cmd"

	appparams "github.com/node101-io/pulsar/chain/app/params"
	app "github.com/node101-io/pulsar/chain/app/provider"
	"github.com/node101-io/pulsar/chain/cmd/interchain-security-pd/cmd"
)

func main() {
	appparams.SetAddressPrefixes("cosmos")
	rootCmd := cmd.NewRootCmd()
	if err := svrcmd.Execute(rootCmd, "", app.DefaultNodeHome); err != nil {
		fmt.Fprintln(rootCmd.OutOrStderr(), err)
		os.Exit(1)
	}
}
