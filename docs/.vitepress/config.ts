import { defineConfig } from "vitepress";
import { withMermaid } from "vitepress-plugin-mermaid";
import llmstxt from "vitepress-plugin-llms";

export default withMermaid(defineConfig({
  title: "Pulsar",
  description: "Pulsar — a Mina-anchored appchain and the pMINA bridge",
  lang: "en-US",
  lastUpdated: true,
  cleanUrls: true,

  head: [
    ["link", { rel: "icon", href: "/favicon.ico", sizes: "32x32" }],
    ["link", { rel: "icon", href: "/favicon-32x32.png", type: "image/png" }],
  ],

  mermaid: {
    theme: "neutral",
  },

  vite: {
    optimizeDeps: {
      // Mermaid pulls dayjs (CJS) in as an ESM default import; the dev
      // server only survives that when both are prebundled together. The
      // production build is unaffected either way.
      include: ["mermaid", "dayjs"],
    },
    plugins: [llmstxt()],
  },

  themeConfig: {
    logo: "/pulsar-mark.svg",

    nav: [
      { text: "Guide", link: "/" },
      { text: "How It Works", link: "/how-it-works" },
    ],

    // One sidebar for the whole site rather than a section per top-level
    // path: at this size, splitting it hid three quarters of the docs behind
    // a nav click.
    sidebar: [
      {
        text: "Using Pulsar",
        items: [
          { text: "Getting Started", link: "/" },
          { text: "Deposit (Mina → Pulsar)", link: "/guide/deposit" },
          { text: "Withdraw (Pulsar → Mina)", link: "/guide/withdraw" },
          { text: "Send pMINA", link: "/guide/send" },
          { text: "Troubleshooting", link: "/guide/troubleshooting" },
        ],
      },
      {
        text: "The Protocol",
        items: [
          { text: "How It Works", link: "/how-it-works" },
          { text: "Network Reference", link: "/network" },
        ],
      },
      {
        text: "Running a Node",
        items: [
          { text: "Bridge Service", link: "/operators/bridge" },
          { text: "Prover Service", link: "/operators/prover" },
        ],
      },
    ],

    search: {
      provider: "local",
    },

    socialLinks: [
      { icon: "github", link: "https://github.com/node101-io/pulsar" },
    ],

    outline: [2, 3],
  },
}));
