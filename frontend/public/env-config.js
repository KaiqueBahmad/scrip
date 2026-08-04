// Placeholder for local dev and static builds. In the Docker image, docker-entrypoint.sh
// overwrites this file at container startup with the real API_BASE_URL env var — see
// frontend/src/lib/api.ts for how it's consumed.
window.__SCRIP_CONFIG__ = {
  apiBaseUrl: '',
};
