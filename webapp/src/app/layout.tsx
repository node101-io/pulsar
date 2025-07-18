"use client"

import type { Metadata } from "next"
import { useState } from "react"
import { Toaster } from "react-hot-toast"
import { Providers } from "./components/providers"
import Header from "./components/header"
import Home from "./components/home"
import Bridge from "./components/bridge"
import Transactions from "./components/transactions"
import Faucet from "./components/faucet"
import { Darker_Grotesque } from "next/font/google"

import "./globals.css"

const darkerGrotesque = Darker_Grotesque({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700", "800", "900"],
})

type Tab = 'home' | 'bridge' | 'transactions' | 'faucet'

export default function RootLayout() {
  const [activeTab, setActiveTab] = useState<Tab>('home')

  const renderContent = () => {
    switch (activeTab) {
      case 'home':
        return <Home />
      case 'bridge':
        return <Bridge />
      case 'transactions':
        return <Transactions />
      case 'faucet':
        return <Faucet />
      default:
        return <Home />
    }
  }

  return (
    <html lang="en">
      <head>
        <title>Pulsar - Cross-Chain Bridge Platform</title>
        <meta name="description" content="The ultimate cross-chain bridge platform for seamless asset transfers" />
        <link rel="icon" href="/favicon.ico" />
      </head>
      <body className={`${darkerGrotesque.className} antialiased`}>
        <Providers>
          <Header activeTab={activeTab} onTabChange={setActiveTab} />
          {renderContent()}
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
        </Providers>
      </body>
    </html>
  )
}
