import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  allowedDevOrigins: [
    "*.lhr.life",
    "*.loca.lt",
  ],
};

export default nextConfig;
