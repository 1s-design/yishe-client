var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// bench-opt.tmp.ts
var ort = __toESM(require("onnxruntime-node"));
var import_path = __toESM(require("path"));
var dir = "/Users/jackie/workspace/yishe-client/resources/ai-upscale-models";
var files = ["real-esrgan-x4plus.onnx", "swin2sr-classical-x4.onnx", "realesr-general-x4v3.onnx"];
async function bench(file, optLevel) {
  const t0 = Date.now();
  const session = await ort.InferenceSession.create(import_path.default.join(dir, file), {
    executionProviders: ["cpu"],
    ...optLevel ? { graphOptimizationLevel: optLevel } : {}
  });
  const loadMs = Date.now() - t0;
  const size = 96;
  const arr = new Float32Array(3 * size * size).fill(0.5);
  const feeds = { [session.inputNames[0]]: new ort.Tensor("float32", arr, [1, 3, size, size]) };
  const t1 = Date.now();
  await session.run(feeds);
  const runMs = Date.now() - t1;
  console.log(`${file.padEnd(30)} opt=${optLevel || "default"} load=${(loadMs / 1e3).toFixed(1)}s run=${(runMs / 1e3).toFixed(1)}s`);
}
async function main() {
  for (const f of files) {
    await bench(f, void 0);
    await bench(f, "all");
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
