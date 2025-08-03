/** @type {import('next').NextConfig} */
const nextConfig = {
  async redirects() {
    return [
      {
        source: '/',
        destination: '/bridge',
        permanent: false,
      },
    ]
  },
  experimental: {
    webpackMemoryOptimizations: true,
  }
}

export default nextConfig
