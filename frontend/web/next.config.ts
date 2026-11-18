import type { NextConfig } from "next";

// Identifies this deployment. Inlined into the client bundle and served by /api/build-id, so an
// open tab can tell when a newer version has been deployed and ask the user to refresh.
const BUILD_ID = process.env.VERCEL_GIT_COMMIT_SHA || String(Date.now());

const nextConfig: NextConfig = {
  env: { NEXT_PUBLIC_BUILD_ID: BUILD_ID },
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
    // Keep visited dynamic pages in the browser's router cache for 30s, so switching back to an
    // admin / squad page is instant. Server actions that call revalidatePath() still clear it,
    // so a page you just changed always shows fresh data.
    // `static` also covers fully prefetched links (the admin nav uses prefetch={true}): those
    // pages load in the background and stay usable for 60s (default is 5 minutes).
    staleTimes: {
      dynamic: 30,
      static: 60,
    },
  },
};

export default nextConfig;
