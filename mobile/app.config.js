// app.json is the app as you run it yourself. EAS's production profile sets APP_VARIANT=tester: that build is
// Pocket under its own permanent ID, so it sits beside your dev build on a phone and never touches its data.
module.exports = ({config}) =>
  process.env.APP_VARIANT === "tester"
    ? {...config, name: "Pocket", ios: {...config.ios, bundleIdentifier: "com.gxme.pinch"}}
    : config;
