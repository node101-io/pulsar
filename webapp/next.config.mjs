/** @type {import('next').NextConfig} */
const nextConfig = {
  async redirects() {
    return [
      {
        source: '/',
        destination: '/bridge',
        permanent: true,
      },
    ]
  },
}

export default nextConfig
