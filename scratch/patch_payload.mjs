import fs from 'fs';
const file = 'firmware/leader_collar/leader_collar.ino';
let code = fs.readFileSync(file, 'utf8');

const oldPayload = `  payload += "\\"sats\\":" + String(satellites) + ",";
  
  int mState = 1;
  if (state == "WARNING") mState = 2;
  else if (state == "HIGH_RISK") mState = 3;
  
  payload += "\\"movement_state\\":" + String(mState) + ",";
  payload += "\\"fix_quality\\":3,";
  payload += "\\"hdop\\":1.2,";
  payload += "\\"event_code\\":0,";
  payload += "\\"seq\\":" + String(telemetrySequence) + ",";
  payload += "\\"battery_pct\\":95,";
  payload += "\\"recorded_at\\":\\"2026-08-28T00:00:00Z\\"";
  payload += "}";`;

const newPayload = `  payload += "\\"sats\\":" + String(satellites) + ",";
  
  int mState = 1;
  if (state == "WARNING") mState = 2;
  else if (state == "HIGH_RISK") mState = 3;
  
  payload += "\\"movement_state\\":" + String(mState) + ",";
  payload += "\\"fix_quality\\":3,";
  payload += "\\"hdop\\":1.2,";
  payload += "\\"event_code\\":0,";
  payload += "\\"seq\\":" + String(telemetrySequence) + ",";
  payload += "\\"battery_pct\\":95,";
  
  // Local Engine Outputs
  payload += "\\"risk_score\\":" + String(riskScore) + ",";
  payload += "\\"boundary_distance\\":" + String(boundaryDistance, 2) + ",";
  payload += "\\"state\\":\\"" + state + "\\",";
  payload += "\\"buzzer_on\\":" + String(buzzerOn ? "true" : "false") + ",";
  
  payload += "\\"recorded_at\\":\\"2026-08-28T00:00:00Z\\"";
  payload += "}";`;

code = code.replace(oldPayload, newPayload);
fs.writeFileSync(file, code);
console.log("Payload updated!");
