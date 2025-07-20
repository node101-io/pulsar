import { j } from "./jstack"
import { priceRouter } from "./routers/price-router"

const api = j
  .router()
  .basePath("/api")
  .use(j.defaults.cors)
  .onError(j.defaults.errorHandler)

const appRouter = j.mergeRouters(api, {
  price: priceRouter,
})

export type AppRouter = typeof appRouter

export default appRouter
