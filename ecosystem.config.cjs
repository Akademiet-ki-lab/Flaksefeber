// pm2-oppsett for Flaksefeber. Brukes av deploy/deploy.sh:
//   pm2 startOrReload ecosystem.config.cjs --update-env
// Porten kan endres med PORT (standard 49000). Appen lytter bare på
// 127.0.0.1, så den må nås gjennom nginx/Apache.
const path = require("node:path");

const port = process.env.PORT || "49000";

module.exports = {
  apps: [
    {
      name: "flaksefeber",
      cwd: __dirname,
      script: "node_modules/next/dist/bin/next",
      args: `start -H 127.0.0.1 -p ${port}`,
      env: {
        NODE_ENV: "production",
        DATA_DIR: path.join(__dirname, "data"),
        // proxyen foran setter X-Real-IP (se deploy/nginx.conf)
        TRUST_PROXY: "1",
      },
      max_memory_restart: "500M",
      restart_delay: 3000,
    },
  ],
};
