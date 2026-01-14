import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Hide the floating dev indicator. In Next 15.3+ the per-key opt-outs
  // (appIsrStatus, buildActivity) were collapsed into a single boolean.
  devIndicators: false,
};

export default nextConfig;
