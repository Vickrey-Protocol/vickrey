/** @type {import('next').NextConfig} */
const nextConfig = {
  // The client library is consumed as TypeScript source from the sibling package.
  transpilePackages: ["@vickrey/client"],
  outputFileTracingRoot: new URL("..", import.meta.url).pathname,
};
export default nextConfig;
