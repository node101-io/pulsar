import * as grpc from "@grpc/grpc-js";
import { GrpcReflection } from "grpc-js-reflection-client";

export interface ValidatorSignature {
    publicKey: string;
    signature: string;
}

export async function createClient(
    serviceName: string,
    rpcAddress: string,
    credentials: grpc.ChannelCredentials,
) {
    const reflectionClient = new GrpcReflection(rpcAddress, credentials);
    const serviceDescriptor = await reflectionClient.getDescriptorBySymbol(serviceName);

    const packageObject = serviceDescriptor.getPackageObject({
        keepCase: true,
        enums: String,
        longs: String,
    });

    let serviceClass: any = packageObject;
    const servicePath = serviceName.split(".");
    const finalServiceName = servicePath.pop();

    for (const part of servicePath) serviceClass = serviceClass[part];
    serviceClass = serviceClass[finalServiceName!];

    return new serviceClass(rpcAddress, credentials);
}

export async function requestSignatures(
    _minaBlockHeight: number,
): Promise<ValidatorSignature[]> {
    // pulsar grpc'den verilen height için validator signature'larını al
    throw new Error("Not implemented: requestSignatures");
}
