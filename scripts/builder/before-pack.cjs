// electron-builder beforePack: the target's ffmpeg goes into the app (see ffmpeg.cjs).
const { useFfmpeg, ARCH } = require("./ffmpeg.cjs");

exports.default = async function beforePack(context) {
	useFfmpeg(context.electronPlatformName, ARCH[context.arch]);
};
