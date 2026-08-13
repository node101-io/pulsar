"use client"

import { Toaster } from "react-hot-toast"
import { MinaWalletProvider } from "@/app/_providers/mina-wallet"
import { QueryClientProvider } from "@/app/_providers/query-client"
import { WorkerProvider } from "@/app/_providers/worker"
import dynamic from "next/dynamic"
import localFont from "next/font/local"

import "./globals.css"

// Client-only: it carries the interchain-kit chain store, which cannot exist
// during prerender and whose dependency graph reaches libsodium's top-level
// await. Excluding it from the server bundle is what lets the pages prerender.
const WalletHeader = dynamic(() => import("./components/wallet-header"), {
  ssr: false,
  loading: () => <div className="h-[var(--header-height)] shrink-0" />,
})

// One variable face covers the whole brand: the marketing site draws every
// weight from 50–1000 off this same axis.
const aspekta = localFont({
  src: "../../fonts/AspektaVF.woff2",
  display: "swap",
  weight: "50 1000",
  variable: "--font-aspekta",
  fallback: ["ui-sans-serif", "system-ui", "sans-serif"],
})

export default function RootLayout({ children }: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className={`${aspekta.variable} bg-canvas text-ink h-dvh w-dvw hide-scrollbar`}>
      <head>
        <title>Pulsar</title>
        <meta name="description" content="Jump to Pulsar" />
        <meta name="theme-color" content="#ffffff" />
        <link rel="icon" href="/favicon-32x32.png" sizes="32x32" type="image/png" />
        <link rel="icon" href="/favicon.ico" sizes="any" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" sizes="320x320" />
      </head>
      <body className="font-sans antialiased h-dvh w-dvw overscroll-none flex flex-col">
        <MinaWalletProvider>
          <QueryClientProvider>
            <WorkerProvider>
              <Toaster
                position="top-center"
                toastOptions={{
                  duration: 3000,
                  style: {
                    background: "#ffffff",
                    color: "#020106",
                    borderRadius: "7px",
                    border: "1px solid #ece2e7",
                    boxShadow: "0 8px 30px rgb(2 1 6 / 8%)",
                    fontSize: "14px",
                  },
                  success: {
                    iconTheme: {
                      primary: "#17794a",
                      secondary: "#ffffff",
                    },
                  },
                  error: {
                    iconTheme: {
                      primary: "#b3261e",
                      secondary: "#ffffff",
                    },
                  },
                }}
              />
              <WalletHeader />
              {children}
            </WorkerProvider>
          </QueryClientProvider>
        </MinaWalletProvider>
      </body>
    </html>
  )
}
