"use client"

import {
  QueryCache,
  QueryClient,
  QueryClientProvider as TanstackQueryClientProvider,
} from "@tanstack/react-query"
import { HTTPException } from "hono/http-exception"
import { useState } from "react"
import { toast } from "react-hot-toast"

export const QueryClientProvider = ({ children }: { children: React.ReactNode }) => {
  const [queryClient] = useState(() => {
    return new QueryClient({
      queryCache: new QueryCache({
        onError: (err) => {
          if (err instanceof HTTPException) {
            toast.error(err.message);
          }
        },
      }),
    })
  });

  return (
    <TanstackQueryClientProvider client={queryClient}>
      {children}
    </TanstackQueryClientProvider>
  )
}
