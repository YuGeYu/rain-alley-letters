/* Rain Alley: complete upstream API, private loopback port. */
import server from "@yiktllw/ncm-api/server";
import { app } from "electron";
import fs from "fs";
import os from "os";
import path from "path";
export async function startNeteaseMusicApi() {
  const token = path.join(os.tmpdir(), "anonymous_token");
  try { fs.writeFileSync(token, "", { flag: "wx" }); }
  catch (error) { if (error.code !== "EEXIST") throw error; }
  const originalLog = console.log.bind(console);
  console.log = (...args) => {
    // Upstream request query and response bodies can contain login cookies.
    if (args[0] === "[OK]" || args[0] === "[ERR]") originalLog(args[0], String(args[1]).split("?")[0]);
    else originalLog(...args);
  };
  // String zero survives upstream options.port || 3000 before Number().
  const service = await server.serveNcmApi({
    port: "0", host: "127.0.0.1", checkVersion: false,
    moduleDefs: require("../ncmModDef"),
  });
  await new Promise((resolve, reject) => {
    if (service.server.listening) return resolve();
    service.server.once("listening", resolve);
    service.server.once("error", reject);
  });
  process.env.XCMUSIC_API_ADDRESS = `http://127.0.0.1:${service.server.address().port}`;
  app.once("will-quit", () => service.server.close());
}
