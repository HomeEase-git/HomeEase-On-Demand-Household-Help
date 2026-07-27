module.exports = function (api) {
  api.cache(true);
  return {
    presets: [
      [require("expo/internal/babel-preset"), { jsxImportSource: "nativewind" }],
    ],
    plugins: ["react-native-reanimated/plugin"],
  };
};
