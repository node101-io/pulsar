"use client"

import type { Metadata } from "next"
import { Toaster } from "react-hot-toast"
import { MinaWalletProvider } from "@/app/_providers/mina-wallet"
import { PulsarWalletProvider } from "@/app/_providers/pulsar-wallet"
import { QueryClientProvider } from "@/app/_providers/query-client"
import Header from "./components/header"
import localFont from "next/font/local"
import { Darker_Grotesque } from "next/font/google"
import { Analytics } from "@vercel/analytics/next"
import { SpeedInsights } from "@vercel/speed-insights/next"

import "./globals.css"

const recady = localFont({
  src: "../../fonts/Recady.woff",
  display: "swap",
  weight: "400",
  variable: "--font-recady",
})

const darkerGrotesque = Darker_Grotesque({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700", "800", "900"],
  variable: "--font-darker-grotesque",
})

export default function RootLayout({ children }: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className={`${recady.variable} ${darkerGrotesque.variable} font-family-recady bg-background h-dvh w-dvw hide-scrollbar`}>
      <head>
        <title>Pulsar</title>
        <meta name="description" content="TODO" />
        <link rel="icon" href="/favicon.ico" />
      </head>
      <body className={`font-recady antialiased h-dvh w-dvw overscroll-none flex flex-col`}>
        <MinaWalletProvider>
          <PulsarWalletProvider>
            <QueryClientProvider>
              <Toaster
                position="top-center"
                toastOptions={{
                  duration: 3000,
                  style: {
                    background: '#fff',
                    color: '#333',
                    borderRadius: '12px',
                    border: '1px solid #e5e7eb',
                    fontSize: '16px',
                  },
                  success: {
                    iconTheme: {
                      primary: '#10b981',
                      secondary: '#fff',
                    },
                  },
                  error: {
                    iconTheme: {
                      primary: '#ef4444',
                      secondary: '#fff',
                    },
                  },
                }}
              />
              <Header />
              {children}
            </QueryClientProvider>
          </PulsarWalletProvider>
        </MinaWalletProvider>
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  )
}
