import { PublicKey, Poseidon, Field, Bool } from "o1js";
import { List } from "pulsar-contracts";

// Validators from chain (X-sorted)
const validators = [
    { base58: "B62qqWJ3J6pQbNJvsSznLztvahyL3hQ6cBPPoWqt1JeUJEbaGajGqUu", x: "4245066326131274004763738574505802794359301098697332426836136436638176535506n", isOdd: false },
    { base58: "B62qrPnGFi3UtZBduEz23acHhPqoBfWaK3mBmE7hCXiydqJwr6ZCSdu", x: "10823663685915116129533719529351995355268290693791233965847711858924571517164n", isOdd: true },
    { base58: "B62qjwtDFLUhQ6iqKSQ7C2yeMbMvCeR6HSEZ736WF4doGVLbmNvs6Ap", x: "11431840522865643192222536051625955764273086251496210753373494272274436228908n", isOdd: true },
];

const TARGET = "14015679198264152470867938812532882375817506640855452120474083659045795882435";

console.log("=== Testing all combinations ===\n");

// Check what toFields() returns
for (const v of validators) {
    const pk = PublicKey.fromBase58(v.base58);
    const fields = pk.toFields();
    console.log(`Validator ${v.base58.slice(0,15)}...`);
    console.log(`  toFields() = [${fields.map(f => f.toString())}]`);
    console.log(`  x=${pk.x.toString()}, isOdd=${pk.isOdd.toString()}`);
    console.log(`  Poseidon([x, isOdd]) = ${Poseidon.hash(pk.toFields()).toString()}`);
    console.log(`  Poseidon([isOdd, x]) = ${Poseidon.hash([pk.isOdd.toField(), pk.x]).toString()}`);
}

// Try: Poseidon([0]) as start, then Poseidon([current, Poseidon([x, isOdd])])
console.log("\n=== X-sorted order (our current approach) ===");
const pks = validators.map(v => PublicKey.fromBase58(v.base58));
let h = Poseidon.hash([Field(0)]);
console.log("Initial:", h.toString());
for (const pk of pks) {
    const valHash = Poseidon.hash(pk.toFields());
    h = Poseidon.hash([h, valHash]);
    console.log("After push:", h.toString(), "(valHash:", valHash.toString(), ")");
}
console.log("Final:", h.toString());
console.log("Target:", TARGET);
console.log("Match:", h.toString() === TARGET);

// Try: using only X (no isOdd)
console.log("\n=== X only (no isOdd) ===");
let h2 = Poseidon.hash([Field(0)]);
for (const pk of pks) {
    const valHash = Poseidon.hash([pk.x]);
    h2 = Poseidon.hash([h2, valHash]);
}
console.log("Final:", h2.toString());
console.log("Match:", h2.toString() === TARGET);

// Try: Poseidon([X, isOdd, 0, 0]) — padded to 4 fields
console.log("\n=== isOdd as first field ===");
let h3 = Poseidon.hash([Field(0)]);
for (const pk of pks) {
    const valHash = Poseidon.hash([pk.isOdd.toField(), pk.x]);
    h3 = Poseidon.hash([h3, valHash]);
}
console.log("Final:", h3.toString());
console.log("Match:", h3.toString() === TARGET);
