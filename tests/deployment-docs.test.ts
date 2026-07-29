import assert from "node:assert/strict";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

const projectFile = (relativePath: string) => fileURLToPath(new URL(`../${relativePath}`, import.meta.url));

test("deployment documentation covers every Compose variable and clean-clone setup", () => {
  const compose = fs.readFileSync(projectFile("docker-compose.yml"), "utf8");
  const envExample = fs.readFileSync(projectFile(".env.example"), "utf8");
  const readme = fs.readFileSync(projectFile("README.md"), "utf8");
  const composeVariables = new Set([...compose.matchAll(/\$\{([A-Z][A-Z0-9_]*)/g)].map((match) => match[1]));
  const exampleVariables = new Set([...envExample.matchAll(/^([A-Z][A-Z0-9_]*)=/gm)].map((match) => match[1]));
  const missingVariables = [...composeVariables].filter((name) => !exampleVariables.has(name)).sort();
  const undocumentedVariables = [...composeVariables].filter((name) => !new RegExp(`\\b${name}\\b`).test(readme)).sort();

  assert.deepEqual(missingVariables, []);
  assert.deepEqual(undocumentedVariables, []);
  assert.match(envExample, /^DATA_PATH=\.\/data$/m);
  assert.match(envExample, /^UPLOAD_PATH=\.\/uploads$/m);
  assert.match(readme, /Copy-Item \.env\.example \.env/);
  assert.doesNotMatch(readme, /默认密码已按要求转换成 bcrypt 哈希保存在本机/);
  for (const name of ["APP_COMMIT_SHA", "APP_COMMIT_DATE", "APP_COMMIT_REF"]) {
    assert.match(readme, new RegExp(`\\b${name}\\b`));
  }
  assert.match(readme, /git status --porcelain[\s\S]*工作区包含未提交改动/);
  assert.match(readme, /COOKIE_SECRET[\s\S]*旧会话/);
});
