import type { Metadata, Viewport } from "next"
import { Toaster } from "react-hot-toast"
import { MinaWalletProvider } from "@/app/_providers/mina-wallet"
import { QueryClientProvider } from "@/app/_providers/query-client"
import { WorkerProvider } from "@/app/_providers/worker"
import WalletHeader from "./components/wallet-header"
import localFont from "next/font/local"

import "./globals.css"

export const metadata: Metadata = {
  title: "Pulsar",
  description: "Jump to Pulsar",
  icons: {
    icon: [
      { url: "/favicon-32x32.png", sizes: "32x32", type: "image/png" },
      { url: "/favicon.ico", sizes: "any" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "320x320" }],
  },
}

export const viewport: Viewport = {
  themeColor: "#ffffff",
}

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
