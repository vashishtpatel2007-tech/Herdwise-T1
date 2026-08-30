/*
  ============================================================
  PASHUGUARD - COLLAR (single unit, GSM only, no LoRa)
  ============================================================

  Hardware:
    ESP32-S3
    GPS (NEO-6M)
    MPU6050
    Quectel EC200U (cellular)
    Buzzer
    Vibration motor

  Architecture:

    GPS + IMU
        |
        v
    LOCAL PREDICTION ENGINE
        |
        +----> Buzzer / Vibration   (instant, local, no network)
        |
        +----> Cellular telemetry -> Supabase
*/

#include <Preferences.h>
#include <TinyGPS++.h>
#include <Wire.h>
#include <math.h>
#include <ArduinoJson.h>

// Telemetry Timing Constants
unsigned long telemetryIntervalMs = 5000;
const unsigned long TELEMETRY_INTERVAL_MIN_MS = 2000;
const unsigned long TELEMETRY_INTERVAL_MAX_MS = 60000;

// --- GSM ---
#define TINY_GSM_DEBUG Serial
#define TINY_GSM_MODEM_SIM7600
#include <TinyGsmClient.h>

#define GSM_RX 6
#define GSM_TX 7
#define GSM_BAUD 115200
#define MODEM_PWRKEY 4

const char apn[] = "airtelgprs.com";
const char gprsUser[] = "";
const char gprsPass[] = "";

HardwareSerial SerialGSM(1);
TinyGsm modem(SerialGSM);

const String url    = "https://bzufqeuaordhrykgsiub.supabase.co/functions/v1/ingest";
const String host    = "bzufqeuaordhrykgsiub.supabase.co";
const String secret  = "6be3390d243cfc602fbce1b5985ef88dd320fdb79593d35640a76bc9a17da336";

bool gsmOK = false;

// --- GPS ---
#define GPS_RX_PIN 17
#define GPS_TX_PIN 18
TinyGPSPlus gps;
HardwareSerial gpsSerial(2);

// --- MPU6050 ---
#define I2C_SDA 8
#define I2C_SCL 9
#define MPU_ADDR 0x68
bool imuOK = false;
float accelScale = 4096.0;

// --- Actuators ---
// Actuator pins removed to avoid conflict with GSM PWRKEY on Pin 4

Preferences prefs;

// ============================================================
// IMU calibration / state
// ============================================================

#define IMU_CALIBRATION_SAMPLES 300
#define IMU_DEADBAND_G 0.05f

float smoothedDynamicAccel = 0.0f;
float smoothedMotionEnergy = 0.0f;
float baselineX = 0.0f, baselineY = 0.0f, baselineZ = 0.0f;
float baselineMagnitude = 1.0f;
float previousX = 0.0f, previousY = 0.0f, previousZ = 0.0f;

float currentAccelX = 0.0f, currentAccelY = 0.0f, currentAccelZ = 0.0f;
float currentAccelMagnitude = 0.0f;
float currentDynamicAcceleration = 0.0f;
float currentMotionEnergy = 0.0f;

// ============================================================
// Boundary
// ============================================================

#define MAX_BOUNDARY_POINTS 8

struct GeoPoint { double lat; double lon; };
GeoPoint boundary[MAX_BOUNDARY_POINTS];
int boundaryCount = 0;
bool boundaryEnabled = false;
int boundaryHash = 0; // Short checksum of coordinates

GeoPoint stagedBoundary[MAX_BOUNDARY_POINTS];
int stagedBoundaryCount = 0;
bool hasStagedBoundary = false;
bool hasClearBoundary = false;
String ackedUUIDs = "";

// ============================================================
// Roads
// ============================================================

#define MAX_ROADS 4

struct Road {
  bool enabled;
  int id;
  int riskLevel; // 1 LOW, 2 MEDIUM, 3 HIGH
  double lat1, lon1, lat2, lon2;
};
Road roads[MAX_ROADS];

// ============================================================
// Prediction state
// ============================================================

double boundaryDistance = -1.0;
double roadDistance = -1.0;
int nearestRoadRisk = 0;
int riskScore = 0;
int highRiskStreak = 0;

String riskType = "SAFE";
String state = "WAITING";
String action = "NONE";

bool buzzerOn = false;
bool vibrationOn = false;

unsigned long manualBeepStartMs = 0;
unsigned long manualBeepDurationMs = 0;

String eventName = "NONE";
double previousBoundaryDistance = -1.0;
double previousRoadDistance = -1.0;
int previousRisk = 0;

uint32_t telemetrySequence = 0;

// ============================================================
// MPU helpers
// ============================================================

void mpuWrite(uint8_t reg, uint8_t value) {
  Wire.beginTransmission(MPU_ADDR);
  Wire.write(reg);
  Wire.write(value);
  Wire.endTransmission();
}

uint8_t mpuRead(uint8_t reg) {
  Wire.beginTransmission(MPU_ADDR);
  Wire.write(reg);
  Wire.endTransmission(false);
  Wire.requestFrom(MPU_ADDR, 1, true);
  if (Wire.available()) return Wire.read();
  return 0;
}

bool readRawAcceleration(float &ax, float &ay, float &az) {
  Wire.beginTransmission(MPU_ADDR);
  Wire.write(0x3B);
  Wire.endTransmission(false);
  Wire.requestFrom(MPU_ADDR, 6, true);
  if (Wire.available() < 6) return false;

  int16_t x = ((int16_t)Wire.read() << 8) | Wire.read();
  int16_t y = ((int16_t)Wire.read() << 8) | Wire.read();
  int16_t z = ((int16_t)Wire.read() << 8) | Wire.read();

  ax = x / accelScale;
  ay = y / accelScale;
  az = z / accelScale;
  return true;
}

void calibrateIMU() {
  Serial.println("\n========================================");
  Serial.println("         IMU CALIBRATION");
  Serial.println("========================================");
  Serial.println("Keep the collar COMPLETELY STILL.");
  Serial.println("Calibration starting in 2 seconds...");
  delay(2000);

  double sumX = 0, sumY = 0, sumZ = 0, sumMagnitude = 0;
  int validSamples = 0;

  for (int i = 0; i < IMU_CALIBRATION_SAMPLES; i++) {
    float ax, ay, az;
    if (readRawAcceleration(ax, ay, az)) {
      float magnitude = sqrt(ax*ax + ay*ay + az*az);
      sumX += ax; sumY += ay; sumZ += az; sumMagnitude += magnitude;
      validSamples++;
    }
    delay(5);
  }

  if (validSamples < 100) {
    Serial.println("IMU calibration FAILED - not enough valid samples.");
    imuOK = false;
    return;
  }

  baselineX = sumX / validSamples;
  baselineY = sumY / validSamples;
  baselineZ = sumZ / validSamples;
  baselineMagnitude = sumMagnitude / validSamples;

  previousX = baselineX; previousY = baselineY; previousZ = baselineZ;
  smoothedDynamicAccel = 0.0f;
  smoothedMotionEnergy = 0.0f;

  Serial.println("IMU calibration COMPLETE");
  Serial.printf("Baseline X:%.4f Y:%.4f Z:%.4f |A|:%.4f  samples:%d\n",
    baselineX, baselineY, baselineZ, baselineMagnitude, validSamples);
  Serial.println("========================================");

  imuOK = true;
}

void updateIMU() {
  if (!imuOK) return;

  float ax, ay, az;
  if (!readRawAcceleration(ax, ay, az)) return;

  currentAccelX = ax; currentAccelY = ay; currentAccelZ = az;
  currentAccelMagnitude = sqrt(ax*ax + ay*ay + az*az);

  float rawDynamic = fabs(currentAccelMagnitude - baselineMagnitude);
  if (rawDynamic < IMU_DEADBAND_G) rawDynamic = 0.0f;

  float dx = ax - previousX, dy = ay - previousY, dz = az - previousZ;
  float rawMotionEnergy = sqrt(dx*dx + dy*dy + dz*dz);
  if (rawMotionEnergy < IMU_DEADBAND_G) rawMotionEnergy = 0.0f;

  const float ALPHA = 0.35f;
  smoothedDynamicAccel = (ALPHA * rawDynamic) + ((1.0f - ALPHA) * smoothedDynamicAccel);
  smoothedMotionEnergy = (ALPHA * rawMotionEnergy) + ((1.0f - ALPHA) * smoothedMotionEnergy);

  currentDynamicAcceleration = smoothedDynamicAccel;
  currentMotionEnergy = smoothedMotionEnergy;

  previousX = ax; previousY = ay; previousZ = az;
}

// ============================================================
// GPS
// ============================================================

void updateGPS() {
  while (gpsSerial.available()) gps.encode(gpsSerial.read());

  static unsigned long lastStatusAt = 0;
  if (millis() - lastStatusAt >= 1000) {
    lastStatusAt = millis();
    Serial.printf("GPS status: chars=%lu checksumOK=%lu fixSentences=%lu "
                  "checksumFail=%lu sats=%d fixValid=%s\n",
                  gps.charsProcessed(), gps.passedChecksum(),
                  gps.sentencesWithFix(), gps.failedChecksum(),
                  gps.satellites.isValid() ? gps.satellites.value() : -1,
                  gps.location.isValid() ? "YES" : "no");
  }
}

// ============================================================
// Geometry
// ============================================================

double distanceMeters(double lat1, double lon1, double lat2, double lon2) {
  const double R = 6371000.0;
  double p1 = radians(lat1), p2 = radians(lat2);
  double dp = radians(lat2 - lat1), dl = radians(lon2 - lon1);
  double a = sin(dp/2)*sin(dp/2) + cos(p1)*cos(p2)*sin(dl/2)*sin(dl/2);
  return R * 2.0 * atan2(sqrt(a), sqrt(1.0-a));
}

void gpsToXY(double lat, double lon, double refLat, double refLon, double &x, double &y) {
  const double R = 6371000.0;
  x = radians(lon - refLon) * cos(radians(refLat)) * R;
  y = radians(lat - refLat) * R;
}

double pointToSegmentDistance(double pLat, double pLon, double aLat, double aLon,
                              double bLat, double bLon) {
  double px, py, ax, ay, bx, by;
  gpsToXY(pLat, pLon, pLat, pLon, px, py);
  gpsToXY(aLat, aLon, pLat, pLon, ax, ay);
  gpsToXY(bLat, bLon, pLat, pLon, bx, by);

  double dx = bx - ax, dy = by - ay;
  double len2 = dx*dx + dy*dy;
  if (len2 < 0.000001) return sqrt(ax*ax + ay*ay);

  double t = ((px-ax)*dx + (py-ay)*dy) / len2;
  t = max(0.0, min(1.0, t));

  double cx = ax + t*dx, cy = ay + t*dy;
  double ex = px - cx, ey = py - cy;
  return sqrt(ex*ex + ey*ey);
}

bool isInsideBoundary(double lat, double lon) {
  if (!boundaryEnabled || boundaryCount < 3) return false;
  bool inside = false;
  for (int i = 0, j = boundaryCount - 1; i < boundaryCount; j = i++) {
    double xi = boundary[i].lon, yi = boundary[i].lat;
    double xj = boundary[j].lon, yj = boundary[j].lat;
    bool intersect = ((yi > lat) != (yj > lat)) &&
                     (lon < (xj - xi) * (lat - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

double getBoundaryDistance(double lat, double lon) {
  if (!boundaryEnabled || boundaryCount < 3) return -1.0;
  double minimum = 1e12;
  for (int i = 0; i < boundaryCount; i++) {
    int j = (i + 1) % boundaryCount;
    double d = pointToSegmentDistance(lat, lon, boundary[i].lat, boundary[i].lon,
                                      boundary[j].lat, boundary[j].lon);
    if (d < minimum) minimum = d;
  }
  return minimum;
}

double getNearestRoadDistance(double lat, double lon, int &risk) {
  risk = 0;
  double minimum = 1e12;
  for (int i = 0; i < MAX_ROADS; i++) {
    if (!roads[i].enabled) continue;
    double d = pointToSegmentDistance(lat, lon, roads[i].lat1, roads[i].lon1,
                                      roads[i].lat2, roads[i].lon2);
    if (d < minimum) { minimum = d; risk = roads[i].riskLevel; }
  }
  return (minimum == 1e12) ? -1.0 : minimum;
}

// ============================================================
// Actuators
// ============================================================

void setWarningActuators(bool enabled) {
  if (!enabled && manualBeepDurationMs != 0 &&
      millis() - manualBeepStartMs < manualBeepDurationMs) {
    return;
  }
  buzzerOn = enabled;
  vibrationOn = enabled;
  // Hardware pins for actuators have been removed to prevent conflicts
}

// ============================================================
// Boundary / road persistence
// ============================================================

void loadBoundary() {
  prefs.begin("boundary", true);
  boundaryCount = prefs.getInt("count", 0);
  if (boundaryCount < 0 || boundaryCount > MAX_BOUNDARY_POINTS) boundaryCount = 0;
  boundaryEnabled = prefs.getBool("enabled", false);
  for (int i = 0; i < boundaryCount; i++) {
    char kLat[12], kLon[12];
    snprintf(kLat, sizeof(kLat), "lat%d", i);
    snprintf(kLon, sizeof(kLon), "lon%d", i);
    boundary[i].lat = prefs.getDouble(kLat, 0.0);
    boundary[i].lon = prefs.getDouble(kLon, 0.0);
  }
  prefs.end();
  Serial.printf("Boundary loaded: %d points\n", boundaryCount);
  
  // Calculate boundaryHash
    uint32_t h = 0;
    for (int i = 0; i < boundaryCount; i++) {
      h = h * 31 + ((int)(boundary[i].lat * 1000000) ^ (int)(boundary[i].lon * 1000000));
    }
    boundaryHash = (int)h;
}

void saveBoundary() {
  prefs.begin("boundary", false);
  prefs.putInt("count", boundaryCount);
  prefs.putBool("enabled", boundaryEnabled);
  for (int i = 0; i < boundaryCount; i++) {
    char kLat[12], kLon[12];
    snprintf(kLat, sizeof(kLat), "lat%d", i);
    snprintf(kLon, sizeof(kLon), "lon%d", i);
    prefs.putDouble(kLat, boundary[i].lat);
    prefs.putDouble(kLon, boundary[i].lon);
  }
  prefs.end();
}

void loadRoads() {
  prefs.begin("roads", true);
  for (int i = 0; i < MAX_ROADS; i++) {
    char key[16];
    snprintf(key, sizeof(key), "en%d", i);   roads[i].enabled  = prefs.getBool(key, false);
    snprintf(key, sizeof(key), "id%d", i);   roads[i].id       = prefs.getInt(key, i);
    snprintf(key, sizeof(key), "risk%d", i); roads[i].riskLevel= prefs.getInt(key, 0);
    snprintf(key, sizeof(key), "lat1_%d", i); roads[i].lat1    = prefs.getDouble(key, 0.0);
    snprintf(key, sizeof(key), "lon1_%d", i); roads[i].lon1    = prefs.getDouble(key, 0.0);
    snprintf(key, sizeof(key), "lat2_%d", i); roads[i].lat2    = prefs.getDouble(key, 0.0);
    snprintf(key, sizeof(key), "lon2_%d", i); roads[i].lon2    = prefs.getDouble(key, 0.0);
  }
  prefs.end();
}

void saveRoad(int index) {
  if (index < 0 || index >= MAX_ROADS) return;
  prefs.begin("roads", false);
  char key[16];
  snprintf(key, sizeof(key), "en%d", index);   prefs.putBool(key, roads[index].enabled);
  snprintf(key, sizeof(key), "id%d", index);   prefs.putInt(key, roads[index].id);
  snprintf(key, sizeof(key), "risk%d", index); prefs.putInt(key, roads[index].riskLevel);
  snprintf(key, sizeof(key), "lat1_%d", index); prefs.putDouble(key, roads[index].lat1);
  snprintf(key, sizeof(key), "lon1_%d", index); prefs.putDouble(key, roads[index].lon1);
  snprintf(key, sizeof(key), "lat2_%d", index); prefs.putDouble(key, roads[index].lat2);
  snprintf(key, sizeof(key), "lon2_%d", index); prefs.putDouble(key, roads[index].lon2);
  prefs.end();
}

// ============================================================
// Local prediction engine
// ============================================================

void runPrediction() {
  eventName = "NONE";

  if (!gps.location.isValid()) {
    riskScore = 0;
    highRiskStreak = 0;
    riskType = "NO_GPS";
    state = "WAITING";
    action = "NONE";
    setWarningActuators(false);
    return;
  }

  double lat = gps.location.lat();
  double lon = gps.location.lng();

  bool inside = isInsideBoundary(lat, lon);
  boundaryDistance = getBoundaryDistance(lat, lon);
  roadDistance = getNearestRoadDistance(lat, lon, nearestRoadRisk);

  int boundaryRisk = 0;
  if (boundaryEnabled && boundaryDistance >= 0) {
    if (!inside)                    boundaryRisk = 100;
    else if (boundaryDistance < 5)  boundaryRisk = 95;
    else if (boundaryDistance < 10) boundaryRisk = 80;
    else if (boundaryDistance < 20) boundaryRisk = 55;
    else if (boundaryDistance < 30) boundaryRisk = 30;
    else                             boundaryRisk = 10;

    if (inside && previousBoundaryDistance >= 0 &&
        boundaryDistance > previousBoundaryDistance + 0.5) {
      boundaryRisk = min(boundaryRisk, 20);
    }
  }

  int roadRisk = 0;
  if (roadDistance >= 0 && nearestRoadRisk > 0) {
    if (roadDistance < 8)       roadRisk = nearestRoadRisk == 3 ? 95 : 75;
    else if (roadDistance < 15) roadRisk = nearestRoadRisk == 3 ? 85 : 65;
    else if (roadDistance < 30) roadRisk = nearestRoadRisk == 3 ? 65 : 45;
    else if (roadDistance < 50) roadRisk = nearestRoadRisk == 3 ? 35 : 25;
    else                         roadRisk = 5;

    if (previousRoadDistance >= 0 && roadDistance > previousRoadDistance + 0.5) {
      roadRisk = min(roadRisk, 20);
    }
  }

  int newRisk = max(boundaryRisk, roadRisk);

  if (newRisk >= 75) {
    state = "HIGH_RISK";
    action = "STEER_AWAY";
    highRiskStreak++;
    setWarningActuators(true);
  } else if (newRisk >= 35) {
    state = "WARNING";
    action = "NONE";
    highRiskStreak = 0;
    setWarningActuators(false);
  } else {
    state = "SAFE";
    action = "NONE";
    highRiskStreak = 0;
    setWarningActuators(false);
  }

  if (boundaryRisk >= roadRisk && boundaryRisk >= 35) riskType = "PERIMETER";
  else if (roadRisk > boundaryRisk && roadRisk >= 35) riskType = "HIGH_TRAFFIC_ROAD";
  else riskType = "SAFE";

  if (previousRisk < 75 && newRisk >= 75)      eventName = "THREAT_DETECTED";
  else if (previousRisk >= 75 && newRisk < 35) eventName = "STEERED_AWAY";

  riskScore = newRisk;
  previousRisk = riskScore;
  previousBoundaryDistance = boundaryDistance;
  previousRoadDistance = roadDistance;
}

// ============================================================
// Native HTTP over GSM
// ============================================================

bool sendNativeHTTP(String payload) {
  modem.sendAT("+QHTTPURL=", url.length(), ",80");
  if (modem.waitResponse(10000L, "CONNECT") != 1) {
    Serial.println("[ERROR] Failed to set URL");
    return false;
  }
  modem.streamWrite(url);
  modem.waitResponse();

  String request = "POST /functions/v1/ingest HTTP/1.1\r\n";
  request += "Host: " + host + "\r\n";
  request += "Content-Type: application/json\r\n";
  request += "x-device-secret: " + secret + "\r\n";
  request += "Content-Length: " + String(payload.length()) + "\r\n\r\n";
  request += payload;

  modem.sendAT("+QHTTPPOST=", request.length(), ",80,80");

  bool connectSuccess = false;
  long t = millis();
  while (millis() - t < 15000) {
    if (modem.stream.available()) {
      String s = modem.stream.readStringUntil('\n');
      s.trim();
      if (s.length() > 0) {
        if (s == "CONNECT") { connectSuccess = true; break; }
        if (s.indexOf("ERROR") != -1) {
          Serial.println("[FATAL] Modem rejected the POST request.");
          return false;
        }
      }
    }
  }
  if (!connectSuccess) {
    Serial.println("[ERROR] Timeout waiting for CONNECT");
    return false;
  }

  modem.streamWrite(request);

  bool postSuccess = false;
  t = millis();
  while (millis() - t < 30000) {
    if (modem.stream.available()) {
      String s = modem.stream.readStringUntil('\n');
      s.trim();
      if (s.length() > 0 && s.startsWith("+QHTTPPOST:")) {
        postSuccess = true;
        break;
      }
    }
  }
  if (!postSuccess) {
    Serial.println("[ERROR] Server never replied to POST");
    return false;
  }

  modem.sendAT("+QHTTPREAD=80");
  if (modem.waitResponse(10000L, "CONNECT") != 1) {
    Serial.println("[ERROR] Modem refused to output HTTP response body");
    return false;
  }

  String response = "";
  // One allocation up front instead of a realloc-and-copy on every appended
  // line. A typical reply is ~200 bytes; one carrying a set_boundary is
  // closer to 700, so 1 KB covers both without growing mid-read.
  response.reserve(1024);
  long readStart = millis();
  // Wait for the full JSON response, breaking when we get the OK.
  // If we just check for '}', it breaks prematurely on nested JSON objects.
  while (millis() - readStart < 5000) {
    if (modem.stream.available()) {
      String line = modem.stream.readStringUntil('\n');
      line.trim();
      if (line == "OK") break;
      if (line.length() > 0) response += line;
    }
    // We can't rely on indexOf('}') if there are nested objects (like boundary points).
    // Instead, we wait for the OK or the timeout.
  }

  Serial.println("--- RESPONSE ---");
  Serial.println(response);
  Serial.println("----------------");

  modem.waitResponse(2000L, "+QHTTPREAD:");

  // Parse JSON response safely (ArduinoJson v7)
  JsonDocument doc;
  DeserializationError error = deserializeJson(doc, response);
  if (error) {
    Serial.printf("[ERROR] JSON parse failed: %s\n", error.c_str());
    return true; // The transmission succeeded (server got the data), just the downlink parse failed
  }

  // 1. Process reporting interval
  if (doc.containsKey("next_interval_s")) {
    long secs = doc["next_interval_s"].as<long>();
    if (secs > 0) {
      unsigned long ms = (unsigned long) secs * 1000UL;
      if (ms < TELEMETRY_INTERVAL_MIN_MS) ms = TELEMETRY_INTERVAL_MIN_MS;
      if (ms > TELEMETRY_INTERVAL_MAX_MS) ms = TELEMETRY_INTERVAL_MAX_MS;
      if (ms != telemetryIntervalMs) {
        Serial.printf("Reporting interval -> %lu ms (server)\n", ms);
        telemetryIntervalMs = ms;
      }
    }
  }

  // 2. Process downlink commands
  JsonArray cmds = doc["commands"].as<JsonArray>();
  for (JsonObject cmdObj : cmds) {
    String cmdName = cmdObj["command"].as<String>();
    String cmdId = cmdObj["id"].is<String>() ? cmdObj["id"].as<String>() : "";
    bool success = false;
    
    if (cmdName == "set_boundary") {
      JsonArray points = cmdObj["payload"]["points"].as<JsonArray>();
      if (points.isNull() || points.size() < 3 || points.size() > MAX_BOUNDARY_POINTS) {
        Serial.printf("[ERROR] Rejected set_boundary: invalid points array size (must be 3-%d)\n", MAX_BOUNDARY_POINTS);
        continue;
      }
      
      bool valid = true;
      int pts = 0;
      for (int i = 0; i < points.size(); i++) {
        JsonArray pt = points[i].as<JsonArray>();
        if (pt.isNull() || pt.size() < 2 || !pt[0].is<double>() || !pt[1].is<double>()) {
          valid = false;
          break;
        }
        double lat = pt[0].as<double>();
        double lon = pt[1].as<double>();
        if (lat < -90.0 || lat > 90.0 || lon < -180.0 || lon > 180.0) {
          valid = false;
          break;
        }
        stagedBoundary[pts].lat = lat;
        stagedBoundary[pts].lon = lon;
        pts++;
      }
      
      if (!valid) {
        Serial.println("[ERROR] Rejected set_boundary: invalid coordinate data");
        continue;
      }
      
      stagedBoundaryCount = pts;
      hasStagedBoundary = true;
      success = true;
      Serial.printf("[DOWNLINK] Staged new boundary with %d points.\n", stagedBoundaryCount);
    }
    else if (cmdName == "clear_boundary") {
      hasClearBoundary = true;
      success = true;
      Serial.println("[DOWNLINK] Staged clear_boundary.");
    }
    else if (cmdName == "locate") {
      long seconds = cmdObj["payload"]["seconds"].as<long>();
      if (seconds > 2) seconds = 2; // Hard-cap at 2s for safety
      if (seconds < 0) seconds = 0;
      
      manualBeepStartMs = millis();
      manualBeepDurationMs = seconds * 1000;
      buzzerOn = (manualBeepDurationMs > 0);
      eventName = "LOCATE";
      success = true;
      Serial.printf("[DOWNLINK] Locate command for %ld s.\n", seconds);
    }

    if (success && cmdId != "") {
      if (ackedUUIDs.length() > 0) ackedUUIDs += ",";
      ackedUUIDs += "\"" + cmdId + "\"";
    }
  }

  if (doc["ok"] == true) return true;

  Serial.println("[ERROR] Supabase did not confirm success (ok != true)");
  return false;
}

// ============================================================
// Telemetry
// ============================================================

void sendTelemetry() {
  telemetrySequence++;

  double lat = gps.location.isValid() ? gps.location.lat() : 0.0;
  double lon = gps.location.isValid() ? gps.location.lng() : 0.0;
  double speed = gps.speed.isValid() ? gps.speed.kmph() : 0.0;
  double heading = gps.course.isValid() ? gps.course.deg() : 0.0;
  int satellites = gps.satellites.isValid() ? gps.satellites.value() : 0;

  Serial.println("\n========== COLLAR PREDICTION ==========");
  Serial.printf("GPS        : %.6f, %.6f\n", lat, lon);
  Serial.printf("Speed      : %.2f km/h\n", speed);
  Serial.printf("Satellites : %d\n", satellites);
  Serial.printf("IMU |A|    : %.3f g   dynamic:%.3f  motion:%.3f\n",
    currentAccelMagnitude, currentDynamicAcceleration, currentMotionEnergy);
  Serial.printf("Boundary   : %.1f m\n", boundaryDistance);
  Serial.printf("Road       : %.1f m (risk %d)\n", roadDistance, nearestRoadRisk);
  Serial.printf("Risk       : %d / 100   [%s]\n", riskScore, riskType.c_str());
  Serial.printf("State      : %s   Action: %s\n", state.c_str(), action.c_str());
  Serial.printf("Buzzer     : %s   Event: %s\n", buzzerOn ? "ON" : "OFF", eventName.c_str());
  Serial.println("========================================");

  if (!gsmOK) {
    Serial.println("[SKIP] GSM not ready, telemetry not sent");
    return;
  }

  int mState = 1;
  if (state == "WARNING") mState = 2;
  else if (state == "HIGH_RISK") mState = 3;

  String pendingAcks = ackedUUIDs;
  ackedUUIDs = ""; // Clear global so any new acks from sendNativeHTTP are appended freshly

  // The builder document lives in its own scope so it is freed BEFORE the
  // HTTP call, which allocates a second JsonDocument for the response.
  // Otherwise two documents and two Strings are alive at peak -- needless
  // on a board whose earlier incarnation died of heap fragmentation.
  String payload;
  {
  JsonDocument doc;
  doc["device_id"] = "PASHU-A01";
  doc["lat"] = lat;
  doc["lon"] = lon;
  doc["speed_kmh"] = speed;
  doc["heading_deg"] = heading;
  doc["sats"] = satellites;
  doc["movement_state"] = mState;
  
  int fixQuality;
  double hdopEstimate;
  if (satellites >= 7)      { fixQuality = 3; hdopEstimate = 1.0; }
  else if (satellites >= 5) { fixQuality = 2; hdopEstimate = 2.5; }
  else if (satellites >= 3) { fixQuality = 2; hdopEstimate = 4.0; }
  else                      { fixQuality = 0; hdopEstimate = 99.9; }

  doc["fix_quality"] = fixQuality;
  doc["hdop"] = hdopEstimate;
  doc["event_code"] = 0;
  doc["seq"] = telemetrySequence;
  
  if (isnan(currentDynamicAcceleration)) {
    doc["acceleration"] = 0.0;
  } else {
    doc["acceleration"] = currentDynamicAcceleration;
  }
  
  doc["risk_score"] = riskScore;
  doc["boundary_distance"] = boundaryDistance;
  doc["state"] = state;
  doc["risk_type"] = riskType;
  doc["boundary_pts"] = boundaryCount;
  doc["boundary_hash"] = boundaryHash;
  
  if (pendingAcks.length() > 0) {
    doc["acked"] = serialized("[" + pendingAcks + "]");
  }
  
  doc["vibration_on"] = vibrationOn;
  doc["buzzer_on"] = buzzerOn;

  serializeJson(doc, payload);
  }

  Serial.println("Transmitting via GSM...");
  if (sendNativeHTTP(payload)) {
    Serial.println("[SUCCESS] Data reached Supabase!");
  } else {
    Serial.println("[ERROR] Transmission failed.");
    // Restore the acks we failed to send, prepending them to any new ones received
    if (pendingAcks.length() > 0) {
      if (ackedUUIDs.length() > 0) {
        ackedUUIDs = pendingAcks + "," + ackedUUIDs;
      } else {
        ackedUUIDs = pendingAcks;
      }
    }
  }
}

// ============================================================
// GSM setup
// ============================================================

void setupGSM() {
  Serial.println("Initializing GSM Modem...");
  SerialGSM.begin(GSM_BAUD, SERIAL_8N1, GSM_RX, GSM_TX);
  delay(3000);

  if (!modem.testAT()) {
    Serial.println("Modem is asleep. Pressing PWRKEY to wake it up...");
    pinMode(MODEM_PWRKEY, OUTPUT);
    digitalWrite(MODEM_PWRKEY, HIGH);
    delay(100);
    digitalWrite(MODEM_PWRKEY, LOW);
    delay(1000);
    digitalWrite(MODEM_PWRKEY, HIGH);
    
    Serial.println("Waiting 10 seconds for modem to boot...");
    delay(10000); 
  } else {
    Serial.println("Modem is already awake!");
  }

  // Clear serial buffer after waking up
  SerialGSM.begin(GSM_BAUD, SERIAL_8N1, GSM_RX, GSM_TX);

  if (!modem.init()) {
    Serial.println("[ERROR] Modem failed to initialize.");
    gsmOK = false;
    return;
  }

  Serial.print("Connecting to Network...");
  if (!modem.waitForNetwork(60000L)) {
    Serial.println(" [FAILED]");
    gsmOK = false;
    return;
  }
  Serial.println(" [OK]");

  Serial.print("Connecting to GPRS...");
  modem.sendAT("+QIDEACT=1");
  modem.waitResponse(10000L);

  modem.sendAT("+QICSGP=1,1,\"", apn, "\",\"", gprsUser, "\",\"", gprsPass, "\",1");
  modem.waitResponse(10000L);

  modem.sendAT("+QIACT=1");
  if (modem.waitResponse(60000L, "OK", "ERROR") != 1) {
    Serial.println(" [FAILED]");
    gsmOK = false;
    return;
  }
  Serial.println(" [OK]");

  Serial.println("Configuring Native HTTP Engine...");
  modem.sendAT("+QHTTPCFG=\"contextid\",1");         modem.waitResponse();
  modem.sendAT("+QHTTPCFG=\"requestheader\",1");     modem.waitResponse();
  modem.sendAT("+QSSLCFG=\"seclevel\",1,0");         modem.waitResponse();
  modem.sendAT("+QSSLCFG=\"sslversion\",1,4");       modem.waitResponse();
  modem.sendAT("+QSSLCFG=\"sni\",1,1");              modem.waitResponse();
  modem.sendAT("+QSSLCFG=\"ciphersuite\",1,0xFFFF"); modem.waitResponse();
  modem.sendAT("+QHTTPCFG=\"sslctxid\",1");          modem.waitResponse();

  gsmOK = true;
  Serial.println("GSM Setup Complete.");
}

// ============================================================
// Setup
// ============================================================

void setup() {
  Serial.begin(115200);
  delay(2500);

  Serial.println("\n============================================");
  Serial.println("      PASHUGUARD - COLLAR");
  Serial.println("      LOCAL PREDICTION ENGINE");
  Serial.println("============================================");

  setupGSM();

  setWarningActuators(false);

  gpsSerial.begin(9600, SERIAL_8N1, GPS_RX_PIN, GPS_TX_PIN);
  Serial.println("GPS serial opened.");

  Wire.begin(I2C_SDA, I2C_SCL);
  Wire.beginTransmission(MPU_ADDR);
  if (Wire.endTransmission() == 0) {
    mpuWrite(0x6B, 0x00); delay(200);
    mpuWrite(0x1C, 0x10);           // +/-8g
    mpuWrite(0x1B, 0x08);           // +/-500 deg/s
    mpuWrite(0x1A, 0x03);           // DLPF
    delay(50);

    uint8_t range = (mpuRead(0x1C) >> 3) & 0x03;
    accelScale = (range==0)?16384.0:(range==1)?8192.0:(range==2)?4096.0:2048.0;
    imuOK = true;

    Serial.println("IMU hardware detected");
    Serial.printf("Accelerometer scale: %.0f LSB/g\n", accelScale);

    calibrateIMU();
  } else {
    Serial.println("IMU FAIL");
    imuOK = false;
  }

  loadBoundary();
  loadRoads();

  Serial.println("\nCOLLAR READY");
  Serial.println("Prediction engine ACTIVE\n");
}

// ============================================================
// Loop
// ============================================================

unsigned long lastTelemetryTime = 0;

void loop() {
  // --- Apply any staged boundary changes safely at the start of the loop ---
  if (hasClearBoundary) {
    boundaryCount = 0;
    boundaryEnabled = false;
    boundaryHash = 0;
    saveBoundary();
    previousBoundaryDistance = -1.0;
    hasClearBoundary = false;
    Serial.println("[ENGINE] Applied clear_boundary.");
  }
  else if (hasStagedBoundary) {
    boundaryCount = stagedBoundaryCount;
    uint32_t h = 0;
    for (int i = 0; i < boundaryCount; i++) {
      boundary[i].lat = stagedBoundary[i].lat;
      boundary[i].lon = stagedBoundary[i].lon;
      h = h * 31 + ((int)(boundary[i].lat * 1000000) ^ (int)(boundary[i].lon * 1000000));
    }
    boundaryHash = (int)h;
    boundaryEnabled = (boundaryCount >= 3);
    saveBoundary();
    previousBoundaryDistance = -1.0;
    hasStagedBoundary = false;
    Serial.println("[ENGINE] Applied set_boundary.");
  }

  updateGPS();
  updateIMU();
  runPrediction();

  if (manualBeepDurationMs != 0 &&
      millis() - manualBeepStartMs >= manualBeepDurationMs) {
    manualBeepDurationMs = 0;
    setWarningActuators(false);
  }

  if (millis() - lastTelemetryTime >= telemetryIntervalMs) {
    sendTelemetry();
    lastTelemetryTime = millis();
  }
}
