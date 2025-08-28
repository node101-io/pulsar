package main

import (
	"fmt"
	"os"

	svrcmd "github.com/cosmos/cosmos-sdk/server/cmd"

	app "github.com/node101-io/pulsar/chain/app/sovereign"
	"github.com/node101-io/pulsar/chain/cmd/interchain-security-sd/cmd"
)

func main() {
	rootCmd := cmd.NewRootCmd()

	if err := svrcmd.Execute(rootCmd, "", app.DefaultNodeHome); err != nil {
		fmt.Fprintln(rootCmd.OutOrStderr(), err)
		os.Exit(1)
	}
}
