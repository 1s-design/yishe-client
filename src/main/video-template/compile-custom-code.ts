/**
 * esbuild 编译器 — 将 AI 生成的 TSX 编译为可执行 JS
 *
 * esbuild 负责 TSX→JS 转译（处理 JSX/类型/ESM），
 * 运行时通过 scope 注入依赖（React/Remotion/Three 等）。
 */
import * as esbuild from "esbuild";

export interface CompileResult {
  success: boolean;
  code: string;
  error?: string;
}

/**
 * 编译 AI 生成的 TSX 代码为可执行 JS
 *
 * 输入：TSX 代码（React 组件或函数体）
 * 输出：JS 代码（可传入 new Function 执行）
 */
export async function compileCustomCode(
  source: string,
  options: { componentName?: string } = {},
): Promise<CompileResult> {
  try {
    // 1. 先用 esbuild 转译 TSX → JS
    const result = await esbuild.build({
      stdin: {
        contents: source,
        loader: "tsx",
      },
      bundle: false,
      format: "cjs",
      write: false,
      target: "es2020",
      jsx: "transform",
      jsxFactory: "React.createElement",
      jsxFragment: "React.Fragment",
    });

    const compiled = result.outputFiles?.[0]?.text;
    if (!compiled) {
      return { success: false, code: "", error: "esbuild 无输出" };
    }

    // 2. 清理 CJS 模块包装（去掉 require/exports/module 注入）
    let cleaned = compiled
      .replace(/"use strict";\s*/g, "")
      .replace(/^const\s+\w+\s*=\s*require\([^)]+\);\s*$/gm, "")
      .replace(/^exports\.\w+\s*=\s*/gm, "")
      .replace(/^module\.exports\s*=\s*/gm, "")
      .replace(/^Object\.defineProperty\(exports,\s*"__esModule".*\$/gm, "");

    return { success: true, code: cleaned };
  } catch (err: any) {
    return {
      success: false,
      code: "",
      error: err?.message || String(err),
    };
  }
}
