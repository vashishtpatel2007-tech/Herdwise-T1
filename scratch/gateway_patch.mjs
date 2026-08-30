import fs from 'fs';

let content = fs.readFileSync('firmware/gateway/gateway.ino', 'utf-8');

// Insert handleSync
const handleSync = `void handleSync() {
  lastCloudCheckin = 0;
  server.send(200, "application/json", "{\\"status\\":\\"syncing\\"}");
}

`;

content = content.replace('void handleSetRoad() {', handleSync + 'void handleSetRoad() {');

// Register /sync
const serverOn = `  server.on(
    "/sync",
    HTTP_POST,
    handleSync
  );

`;
content = content.replace('  server.on(\n    "/set-road",', serverOn + '  server.on(\n    "/set-road",');

fs.writeFileSync('firmware/gateway/gateway.ino', content);
console.log("Patched gateway.ino with /sync endpoint");
