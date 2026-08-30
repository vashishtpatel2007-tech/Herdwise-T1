const fs = require('fs');

const gatewayFile = 'firmware/gateway/gateway.ino';
const dashboardFile = 'scratch/dashboard.html';

let gatewayCode = fs.readFileSync(gatewayFile, 'utf8');
const dashboardHtml = fs.readFileSync(dashboardFile, 'utf8');

const startMarker = 'String html = R"rawliteral(';
const endMarker = ')rawliteral";';

const startIndex = gatewayCode.indexOf(startMarker);
const endIndex = gatewayCode.indexOf(endMarker, startIndex);

if (startIndex === -1 || endIndex === -1) {
  console.error("Could not find rawliteral bounds");
  process.exit(1);
}

const newGatewayCode = 
  gatewayCode.substring(0, startIndex + startMarker.length) + 
  '\n' + dashboardHtml + '\n' +
  gatewayCode.substring(endIndex);

fs.writeFileSync(gatewayFile, newGatewayCode);
console.log("Successfully injected modified dashboard into gateway.ino");
