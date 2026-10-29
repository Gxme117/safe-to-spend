// For the accountant smoke test only (src/lib/ai/__tests__/accountant.smoke.ts): Expo's test setup swaps the global fetch for a
// stub, so this hands the test Node's real one as `realFetch` before that happens.
const {TestEnvironment} = require("jest-environment-node");

module.exports = class RealFetch extends TestEnvironment {
  constructor(config, context) {
    super(config, context);
    this.global.realFetch = fetch;
  }
};
