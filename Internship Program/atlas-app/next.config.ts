import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      /**
       * Next caps a Server Action body at 1MB by default. Multi-file org
       * uploads clear that immediately — an establishment export plus a
       * payroll extract plus an org-chart image is several megabytes — and
       * the request is rejected before the action runs, so the app never gets
       * the chance to explain itself and the upload simply appears to do
       * nothing.
       *
       * Note this is not the only ceiling in play: the host applies its own
       * request-body limit at the edge, before the request reaches Next at
       * all, so on a deployment the effective maximum is the lower of the
       * two. MAX_UPLOAD_BYTES in lib/ingest/formats.ts is what the upload
       * form enforces, and is the number a user is actually held to.
       */
      bodySizeLimit: "10mb",
    },
  },
};

export default nextConfig;
