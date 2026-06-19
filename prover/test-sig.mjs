import { verifyLegacy } from "./node_modules/o1js/dist/node/mina-signer/src/signature.js";
import { HashInputLegacy, hashWithPrefix } from "./node_modules/o1js/dist/node/mina-signer/src/poseidon-bigint.js";
import * as grpc from "@grpc/grpc-js";
import { GrpcReflection } from "grpc-js-reflection-client";

function hexToBytes(hex) {
    const h = hex.startsWith('0x') ? hex.slice(2) : hex;
    const b = new Uint8Array(h.length/2);
    for (let i=0;i<h.length;i+=2) b[i/2]=parseInt(h.slice(i,i+2),16);
    return b;
}
function toBigIntLE(bytes) {
    let v=0n; for (let i=bytes.length-1;i>=0;i--) v=(v<<8n)|BigInt(bytes[i]); return v;
}
function publicKeyFromBytes(buf) {
    if (buf.length === 32) {
        const x = Uint8Array.from(buf);
        const isOdd = (x[31] & 0x80) !== 0;
        x[31] &= 0x7f;
        return { x: toBigIntLE(x), isOdd };
    }
    return { x: BigInt("0x"+Buffer.from(buf).slice(0,32).toString("hex")), isOdd: buf[32]===1 };
}
function signatureFromBytes(buf) {
    return { r: toBigIntLE(buf.slice(0,32)), s: toBigIntLE(buf.slice(32,64)) };
}
function bytesToBitsInput(buf) {
    const bits = [];
    for (const b of buf) for (let i=7;i>=0;i--) bits.push(((b>>i)&1)===1);
    return HashInputLegacy.bits(bits);
}

// o1jsBytesToFields: 31-byte LE chunks + stop byte
function o1jsBytesToFields(data) {
    const fields = []; let offset = 0;
    while (offset + 31 <= data.length) {
        const chunk = data.slice(offset, offset+31);
        const be = Buffer.alloc(32,0);
        for (let i=0;i<31;i++) be[31-i]=chunk[i];
        fields.push(BigInt("0x"+be.toString("hex")));
        offset += 31;
    }
    const last = data.slice(offset);
    const be = Buffer.alloc(32,0);
    for (let i=0;i<last.length;i++) be[31-i]=last[i];
    be[31-last.length] = 0x01;
    fields.push(BigInt("0x"+be.toString("hex")));
    return fields;
}

// Compute HashWithPrefix correctly: just pass data fields to hashWithPrefix
// hashWithPrefix(prefix_string, fields) handles the prefix internally
function computeMsgHash(prefix, dataBytes) {
    const dataFields = o1jsBytesToFields(dataBytes);
    let padded = [...dataFields];
    if (padded.length === 0) padded.push(0n);
    while (padded.length % 2 !== 0) padded.push(0n);
    // hashWithPrefix applies prefix to sponge, then absorbs dataFields
    const hashField = hashWithPrefix(prefix, padded);
    // Convert field element to BIG-ENDIAN bytes (Go standard)
    const be = Buffer.alloc(32);
    let val = BigInt(hashField.toString());
    for (let i=31;i>=0;i--) { be[i]=Number(val&0xffn); val>>=8n; }
    return be;
}

async function createClient(svc, addr, creds) {
    const rc = new GrpcReflection(addr, creds);
    const sd = await rc.getDescriptorBySymbol(svc);
    const pkg = sd.getPackageObject({ keepCase: true, enums: String, longs: String });
    let cls = pkg;
    const parts = svc.split(".");
    const last = parts.pop();
    for (const p of parts) cls = cls[p];
    return new (cls[last])(addr, creds);
}

const rpc = "65.108.68.236:9090";
const creds = grpc.credentials.createInsecure();
const vp   = await createClient("pulsarchain.votepersistence.v1.Query", rpc, creds);
const tm   = await createClient("cosmos.base.tendermint.v1beta1.Service", rpc, creds);
const abci = await createClient("pulsarchain.abci.Query", rpc, creds);

const latestH = Number((await new Promise((r,e)=>tm.GetLatestBlock({},(err,res)=>err?e(err):r(res)))).block.header.height);
const targetH = latestH - 3;

const abciRes = await new Promise((r,e)=>abci.VoteExtBodyByHeight({vote_extension_height:targetH+2},(err,res)=>err?e(err):r(res)));
const b = abciRes?.vote_ext_body ?? abciRes?.voteExtBody ?? abciRes;
const nvsh = Buffer.from(b?.next_validator_set_hash ?? b?.nextValidatorSetHash ?? "");
const sr   = Buffer.from(b?.current_state_root ?? b?.currentStateRoot ?? "");
const h    = Number(b?.current_block_height ?? b?.currentBlockHeight ?? 0);
const ar   = b?.actions_reduced_root ?? b?.actionsReducedRoot ?? "pulsar";

function encodeBody(nvsh, sr, h, ar) {
    const p=[];
    const n=Buffer.alloc(4); n.writeUInt32BE(nvsh.length); p.push(n,nvsh);
    const s=Buffer.alloc(4); s.writeUInt32BE(sr.length);   p.push(s,sr);
    const hb=Buffer.alloc(8); hb.writeBigUInt64BE(BigInt(h)); p.push(hb);
    const arb=Buffer.from(ar,"utf8");
    const a=Buffer.alloc(4); a.writeUInt32BE(arb.length); p.push(a,arb);
    return Buffer.concat(p);
}

const encoded = encodeBody(nvsh, sr, h, ar);
console.log(`H=${h}, encoded=${encoded.length}B, ar="${ar}"`);
console.log(`nvsh len=${nvsh.length}, sr len=${sr.length}`);

const msgHashBE = computeMsgHash("pulsar-vote-ext-body", encoded);
console.log("msgHashBE:", msgHashBE.toString("hex").slice(0,20)+"...");

const meta = new grpc.Metadata();
meta.add("x-cosmos-block-height", (targetH+3).toString());
const vpRes = await new Promise((r,e)=>vp.VoteExtensions({},meta,(err,res)=>err?e(err):r(res)));
const exts = vpRes?.vote_extensions ?? vpRes?.voteExtensions ?? [];

console.log(`\nExtensions: ${exts.length}`);
for (let i=0; i<exts.length; i++) {
    const ext = exts[i];
    const pkRaw  = Buffer.from(ext.mina_public_key ?? ext.minaPublicKey, "base64");
    const sigRaw = Buffer.from(ext.vote_extension  ?? ext.voteExtension,  "base64");
    const pk  = publicKeyFromBytes(pkRaw);
    const sig = signatureFromBytes(sigRaw);
    const msg = bytesToBitsInput(msgHashBE);
    
    console.log(`\nValidator ${i+1}: pkLen=${pkRaw.length} isOdd=${pk.isOdd}`);
    console.log(`  verifyLegacy(mainnet)=${verifyLegacy(sig,msg,pk,'mainnet')}`);
    console.log(`  verifyLegacy(testnet)=${verifyLegacy(sig,msg,pk,'testnet')}`);
}
