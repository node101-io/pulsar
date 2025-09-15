npm version patch && npm run clean && npm i && npm run build && npm publish
sleep 10
cd ../prover && npm uninstall pulsar-contracts && npm i pulsar-contracts && npm run build 
cd ../signer-node && npm uninstall pulsar-contracts && npm i pulsar-contracts && npm run build