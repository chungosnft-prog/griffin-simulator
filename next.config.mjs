/** @type {import('next').NextConfig} */
// GitHub Pages: static export served from /<repo>/ (set by .github/workflows/pages.yml)
const basePath = process.env.NEXT_PUBLIC_BASE_PATH || ""

const nextConfig = {
  reactStrictMode: true,
  ...(process.env.STATIC_EXPORT ? { output: "export", basePath, assetPrefix: basePath || undefined, distDir: ".next-export" } : {}),
  transpilePackages: ['three'],
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
  // Remove experimental features that might not be available in 13.5.6
  experimental: {
    // Remove forceSwcTransforms as it might not be available
  },
  // Headers removed - COOP/COEP can break WebGL/WebAssembly on some deployment platforms
  // If needed, add back with less strict values for specific routes only
  // Ensure static export compatibility
  trailingSlash: false,
  // Optimize for deployment
  compress: true,
  poweredByHeader: false,
}

export default nextConfig
