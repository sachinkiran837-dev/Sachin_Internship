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
       * 4MB is the ceiling worth setting: Vercel rejects a serverless request
       * body over 4.5MB at its own edge, so a larger value here would pass in
       * development only to fail in production. The upload form enforces the
       * same number client-side (MAX_UPLOAD_BYTES) so the user is told before
       * submitting rather than after.
       */
      bodySizeLimit: "4mb",
    },
  },
};

export default nextConfig;
