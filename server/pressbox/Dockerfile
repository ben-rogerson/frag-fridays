# Playwright base ships Node + Chromium + all X/GL deps pre-installed, so the
# image build is a plain COPY - no npm install, no browser download. Pin the
# tag so the build is reproducible; bump manually when Playwright releases.
FROM mcr.microsoft.com/playwright:v1.48.0-jammy
WORKDIR /app
COPY pressbox.js .
# /out is the screenshot volume the compose file mounts. Create the mount
# point so the container can start even without a bind-mount attached.
RUN mkdir -p /out
EXPOSE 27060
CMD ["node", "pressbox.js"]
