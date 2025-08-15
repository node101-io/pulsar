import * as path from "path";
import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";

export const PROTO_DIR = path.join(process.cwd(), "src/proto");

export const resolveProtoPath = (protoFile: string, baseDir: string = PROTO_DIR) => {
  if (path.isAbsolute(protoFile)) return protoFile;
  return path.join(baseDir, protoFile);
};

export const loadService = (
  protoFile: string,
  pkgPath: string,
  serviceName: string,
) => {
  const def = protoLoader.loadSync(protoFile, {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true,
  });
  const loaded = grpc.loadPackageDefinition(def) as Record<string, any>;
  const pkg = pkgPath.split(".").reduce((o: any, k: string) => (o ? o[k] : undefined), loaded);
  return pkg?.[serviceName];
};

