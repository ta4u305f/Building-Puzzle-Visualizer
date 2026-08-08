import type { NextConfig } from "next";

const repository = process.env.GITHUB_REPOSITORY?.split("/") ?? [];
const repositoryOwner = repository[0] ?? "";
const repositoryName = repository[1] ?? "";
const pagesPath = repositoryName.endsWith(".github.io") ? "" : `/${repositoryName}`;
const pagesUrl =
  process.env.GITHUB_ACTIONS === "true" && repositoryOwner
    ? `https://${repositoryOwner}.github.io${pagesPath}`
    : "";

const nextConfig: NextConfig = {
  output: "export",
  trailingSlash: true,
  images: { unoptimized: true },
  assetPrefix: pagesUrl,
};

export default nextConfig;
