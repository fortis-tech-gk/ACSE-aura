import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ['*', '*.ngrok-free.dev', '*.ngrok.io', 'manmade-navigator-hurled.ngrok-free.dev'],
  images: {
    // Athlete photos live in Supabase storage. Anything else is refused by /_next/image, so the
    // optimizer cannot be used as a free proxy for arbitrary internet images.
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '*.supabase.co',
      },
    ],
  },
  experimental: {
    serverActions: {
      bodySizeLimit: '10mb',
    },
  },
};

export default nextConfig;
