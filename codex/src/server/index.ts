import { createSteambenchApp } from "./app";

const port = Number(process.env.STEAMBENCH_API_PORT ?? 8787);
const app = createSteambenchApp();

app.listen(port, "127.0.0.1", () => {
  console.log(`steambench-api listening on http://127.0.0.1:${port}`);
});
