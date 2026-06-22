import { spawn } from "node:child_process";

const pnpmCli = process.env.npm_execpath;
const command = pnpmCli ? process.execPath : "pnpm";
const runArgs = (script) => (pnpmCli ? [pnpmCli, "run", script] : ["run", script]);

const children = [
  spawn(command, runArgs("server"), { stdio: "inherit" }),
  spawn(command, runArgs("client"), { stdio: "inherit" })
];

const shutdown = () => {
  for (const child of children) child.kill();
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

for (const child of children) {
  child.on("exit", (code) => {
    if (code && code !== 0) shutdown();
  });
}
