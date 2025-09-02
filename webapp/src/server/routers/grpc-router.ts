import { j, publicProcedure } from "../jstack";
import { z } from "zod";
import * as grpc from "@grpc/grpc-js";
import { loadService, PROTO_DIR, resolveProtoPath } from "../utils/grpc";

const TARGET_HOST = "5.9.42.22:9091";

export const grpcRouter = j.router({
  call: publicProcedure
    .input(
      z.object({
        protoFile: z.string().min(1),
        pkg: z.string().min(1),
        service: z.string().min(1),
        method: z.string().min(1),
        request: z.record(z.any()),
      })
    )
    .mutation(async ({ c, input }) => {
      try {
        const ServiceCtor = loadService(
          resolveProtoPath(input.protoFile, PROTO_DIR),
          input.pkg,
          input.service
        );

        if (typeof ServiceCtor !== "function") {
          return c.json(
            {
              success: false,
              error: "ServiceNotFound",
              message: `Service ${input.pkg}.${input.service} not found in ${input.protoFile}`,
            },
            400 as any
          );
        }

        const client = new ServiceCtor(TARGET_HOST, grpc.credentials.createInsecure());

        const requestPayload = coerceBytesFields(input.request);

        const response = await new Promise<any>((resolve, reject) => {
          const fn: any = (client as any)[input.method];
          if (typeof fn !== "function") {
            reject(
              Object.assign(new Error(`Method ${input.method} not found`), {
                code: "MethodNotFound",
              })
            );
            return;
          }
          fn.call(client, requestPayload, (err: any, resp: any) => {
            if (err) {
              reject(err);
              return;
            }
            resolve(resp);
          });
        });

        return c.json({ success: true, data: response });
      } catch (err: any) {
        const statusCode = mapGrpcErrorToHttpStatus(err);
        return c.json(
          {
            success: false,
            error: err?.code ?? "GrpcError",
            message: err?.details || err?.message || "Unknown gRPC error",
          },
          statusCode as any
        );
      }
    }),
});

const mapGrpcErrorToHttpStatus = (err: any): number => {
  const code = err?.code;
  switch (code) {
    case grpc.status.INVALID_ARGUMENT:
    case grpc.status.FAILED_PRECONDITION:
    case grpc.status.OUT_OF_RANGE:
      return 400;
    case grpc.status.UNAUTHENTICATED:
      return 401;
    case grpc.status.PERMISSION_DENIED:
      return 403;
    case grpc.status.NOT_FOUND:
      return 404;
    case grpc.status.ALREADY_EXISTS:
    case grpc.status.ABORTED:
    case grpc.status.UNAVAILABLE:
      return 409;
    case grpc.status.RESOURCE_EXHAUSTED:
      return 429;
    case grpc.status.UNIMPLEMENTED:
      return 501;
    case grpc.status.DEADLINE_EXCEEDED:
      return 504;
    default:
      return 500;
  }
};

const coerceBytesFields = (obj: any): any => {
  if (obj == null) return obj;
  if (Array.isArray(obj)) return obj.map(coerceBytesFields);
  if (typeof obj !== "object") return obj;

  const result: Record<string, any> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (
      typeof value === "string" &&
      (key.endsWith("Bytes") || key.endsWith("_bytes")) &&
      isLikelyBase64(value)
    ) {
      try {
        result[key] = Buffer.from(value, "base64");
      } catch {
        result[key] = value;
      }
    } else {
      result[key] = coerceBytesFields(value);
    }
  }
  return result;
};

const isLikelyBase64 = (str: string): boolean => {
  // Basic heuristic: base64 strings length is multiple of 4 and only allowed chars
  if (!str || str.length % 4 !== 0) return false;
  return /^[A-Za-z0-9+/=]+$/.test(str);
};

