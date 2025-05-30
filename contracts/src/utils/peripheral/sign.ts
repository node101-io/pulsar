import { Field, PrivateKey, Signature } from 'o1js';
import { createWriteStream } from 'fs';
import { once } from 'events';

async function createRandomSignature(messageLength: number) {
  const privateKey = PrivateKey.random();
  let message = [];
  for (let i = 0; i < messageLength; i++) {
    message.push(Field.random());
  }
  const signature = Signature.create(privateKey, message);
  return {
    privateKey: privateKey.toJSON(),
    message: message.map((f) => f.toJSON()),
    signature: signature.toJSON(),
  };
}

async function saveSignaturesStreaming(
  iterations: number,
  _messageLength: number,
  filename: string
) {
  const stream = createWriteStream(filename, { encoding: 'utf8' });
  stream.write('[');

  for (let i = 0; i < iterations; i++) {
    const messageLength = Math.floor(Math.random() * _messageLength) + 1;
    const entry = await createRandomSignature(messageLength);
    if (i > 0) stream.write(',');
    stream.write('\n' + JSON.stringify(entry));
  }

  stream.write('\n]');
  stream.end();
  await once(stream, 'finish');
  console.log(`Wrote ${iterations} signatures to ${filename}`);
}

await saveSignaturesStreaming(100000, 255, '3.json');
