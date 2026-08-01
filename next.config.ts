import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // tesseract.js / sharp usan binarios nativos — no bundlear en el server chunk
  serverExternalPackages: ["tesseract.js", "sharp"],
};

export default nextConfig;
