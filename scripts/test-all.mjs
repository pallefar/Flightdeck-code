import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));

export function createTestCommands(vitestArgs = []) {
  return [
    [process.execPath, [fileURLToPath(new URL("../node_modules/vitest/vitest.mjs", import.meta.url)), "run", ...vitestArgs]],
    [process.execPath, ["--test", "deploy/studio-docker/*.test.mjs"]],
    [process.execPath, [fileURLToPath(new URL("../designer-source/tests/run.mjs", import.meta.url))]],
  ];
}

export function runTestCommands(commands) {
  let exitCode = 0;
  for (const [command, args] of commands) {
    const result = spawnSync(command, args, { cwd: root, stdio: "inherit", shell: false });
    if (result.error) console.error(`Test runner could not start: ${result.error.message}`);
    if (result.status !== 0) exitCode = 1;
  }
  return exitCode;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = runTestCommands(createTestCommands(process.argv.slice(2)));
}
