import { j } from "./jstack";
import { priceRouter } from "./routers/price-router";
import { faucetRouter } from "./routers/faucet-router";
import { grpcRouter } from "./routers/grpc-router";

const api = j
  .router()
  .basePath("/api")
  .use(j.defaults.cors)
  .onError(j.defaults.errorHandler);

const appRouter = j.mergeRouters(api, {
  price: priceRouter,
  faucet: faucetRouter,
  grpc: grpcRouter,
});

export type AppRouter = typeof appRouter;

export default appRouter;
