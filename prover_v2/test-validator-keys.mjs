import * as grpc from "@grpc/grpc-js";
import { GrpcReflection } from "grpc-js-reflection-client";
import { PublicKey, Field, Bool } from "o1js";

async function createClient(serviceName, rpcAddress, credentials) {
    const reflectionClient = new GrpcReflection(rpcAddress, credentials);
    const sd = await reflectionClient.getDescriptorBySymbol(serviceName);
    const pkg = sd.getPackageObject({ keepCase: true, enums: String, longs: String });
    let cls = pkg;
    const parts = serviceName.split(".");
    const last = parts.pop();
    for (const p of parts) cls = cls[p];
    return new (cls[last])(rpcAddress, credentials);
}

function tryParseKey(rawBuf, label, xBuf, isOdd) {
    try {
        const x = BigInt("0x" + xBuf.toString("hex"));
        const pubKey = PublicKey.from({ x: Field(x), isOdd: Bool(isOdd) });
        const base58 = pubKey.toBase58();
        PublicKey.fromBase58(base58); // validate
        console.log(`  ✓ [${label}] isOdd=${isOdd} base58=${base58}`);
        return true;
    } catch (e) {
        console.log(`  ✗ [${label}] isOdd=${isOdd} → ${e.message}`);
        return false;
    }
}

const rpcAddress = "65.108.68.236:9090";
const creds = grpc.credentials.createInsecure();

const tmClient = await createClient("cosmos.base.tendermint.v1beta1.Service", rpcAddress, creds);
const krClient = await createClient("pulsarchain.keyregistry.v1.Query", rpcAddress, creds);

const HEIGHT = 1;
const res = await new Promise((resolve, reject) =>
    tmClient.GetValidatorSetByHeight({ height: HEIGHT.toString() }, (err, r) => err ? reject(err) : resolve(r))
);

console.log(`Block ${HEIGHT} — ${res.validators.length} validators\n`);

for (let i = 0; i < res.validators.length; i++) {
    const v = res.validators[i];
    const anyValue = Buffer.from(v.pub_key?.value ?? []);
    const pubKeyBytes = anyValue.length >= 34 ? anyValue.subarray(2, 34) : Buffer.alloc(0);

    console.log(`--- Validator ${i} ---`);
    console.log("  ed25519:", pubKeyBytes.toString("hex"));

    const minaRaw = await new Promise((resolve, reject) =>
        krClient.GetValidatorMinaPubKey({ validator_cosmos_pub_key: pubKeyBytes }, (err, r) => err ? reject(err) : resolve(r))
    );

    const rawBuf = Buffer.from(minaRaw.validator_mina_pub_key);
    console.log("  raw hex:", rawBuf.toString("hex"), `(${rawBuf.length} bytes)`);

    // Interpretation A: all 32 bytes = x, isOdd = false (current broken behavior)
    tryParseKey(rawBuf, "A: 32 bytes x, isOdd=false", rawBuf, false);
    tryParseKey(rawBuf, "A: 32 bytes x, isOdd=true", rawBuf, true);

    // Interpretation B: top bit of last byte = isOdd, remaining = x
    const lastByteIsOdd = (rawBuf[31] & 0x80) !== 0;
    const xBufB = Buffer.from(rawBuf);
    xBufB[31] = rawBuf[31] & 0x7f; // clear top bit
    tryParseKey(rawBuf, "B: last-byte MSB isOdd", xBufB, lastByteIsOdd);

    // Interpretation C: top bit of first byte = isOdd, remaining = x
    const firstByteIsOdd = (rawBuf[0] & 0x80) !== 0;
    const xBufC = Buffer.from(rawBuf);
    xBufC[0] = rawBuf[0] & 0x7f;
    tryParseKey(rawBuf, "C: first-byte MSB isOdd", xBufC, firstByteIsOdd);

    console.log();
}
