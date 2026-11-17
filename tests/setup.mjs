/* node --test 로 src/*.ts 를 직접 불러오기 위한 경로 해석
   - "@/lib/x" → src/lib/x.ts
   - 확장자 없는 상대 경로 → .ts / .tsx */
import { registerHooks } from "node:module";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(import.meta.dirname, "..");

registerHooks({
  resolve(spec, ctx, next) {
    let target = null;
    if (spec.startsWith("@/")) target = path.join(root, "src", spec.slice(2));
    else if (spec.startsWith(".") && ctx.parentURL?.startsWith("file:")) target = path.resolve(path.dirname(fileURLToPath(ctx.parentURL)), spec);
    if (target && !path.extname(target)) {
      for (const ext of [".ts", ".tsx", "/index.ts"]) {
        if (existsSync(target + ext)) return next(pathToFileURL(target + ext).href, ctx);
      }
    }
    if (target && spec.startsWith("@/")) return next(pathToFileURL(target).href, ctx);
    return next(spec, ctx);
  },
});
