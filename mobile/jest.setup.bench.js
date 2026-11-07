// Restores Node's real fetch for the benchmark tests.
// jest-expo installs React Native's whatwg-fetch polyfill, which uses XHR and returns undefined
// in Node.js. The benchmark calls real Supabase endpoints, so it needs the real fetch.
// Guard on TEST_CLASSIFY so normal tests are unaffected.
if (process.env.TEST_CLASSIFY) {
  const fetchShim = require("fetch-nodeshim");
  globalThis.fetch = fetchShim.default || fetchShim;
}
