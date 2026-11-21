import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // wicker.life embeds the site in its full-screen live view; no other site may frame it.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [{ key: "Content-Security-Policy", value: "frame-ancestors 'self' https://wicker.life" }],
      },
    ];
  },
};

export default nextConfig;
