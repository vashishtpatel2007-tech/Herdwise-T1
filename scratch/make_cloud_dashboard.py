import re

with open("scratch/dashboard.html", "r") as f:
    content = f.read()

supabase_script = """
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
<script>
  const supabaseUrl = 'https://bzufqeuaordhrykgsiub.supabase.co';
  const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ6dWZxZXVhb3JkaHJ5a2dzaXViIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY0MzMzODYsImV4cCI6MjEwMjAwOTM4Nn0.k5ZKRnENWqn-cQ2KDIbzWkVIExobr3q8TqELlnyWeHU';
  const supabase = supabase.createClient(supabaseUrl, supabaseKey);
  const animalId = '90ed1aeb-1250-482a-bdbe-1376e10f3c64'; // PASHU-A01

  let boundaryData = { configured: false, point_count: 0, coordinates: '' };

  async function initSupabase() {
    // Get zone
    const { data: zones } = await supabase.from('zones').select('*');
    if (zones && zones.length > 0) {
      const coords = zones[0].coordinates;
      let pts = [];
      coords.forEach(c => pts.push(c[0] + ',' + c[1]));
      boundaryData = {
        configured: true,
        point_count: coords.length,
        coordinates: pts.join(';')
      };
    }

    // Subscribe to latest_positions and risk_state
    supabase.channel('public:latest_positions')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'latest_positions', filter: 'animal_id=eq.'+animalId }, payload => {
        handleTelemetryUpdate(payload.new);
      })
      .subscribe();
      
    supabase.channel('public:risk_state')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'risk_state', filter: 'animal_id=eq.'+animalId }, payload => {
        handleRiskUpdate(payload.new);
      })
      .subscribe();
      
    // Initial fetch
    const { data: pos } = await supabase.from('latest_positions').select('*').eq('animal_id', animalId).single();
    if (pos) handleTelemetryUpdate(pos);
    const { data: risk } = await supabase.from('risk_state').select('*').eq('animal_id', animalId).single();
    if (risk) handleRiskUpdate(risk);
    
    document.getElementById('gatewayStatus').innerText = 'Cloud — Connected';
  }

  let latestData = {
    sequence: 0,
    latitude: 0,
    longitude: 0,
    speed: 0,
    heading: 0,
    satellites: 0,
    acceleration: 0,
    boundary_distance: -1,
    road_distance: -1,
    boundary_configured: false,
    boundary_point_count: 0,
    risk_score: 0,
    risk_type: 'NONE',
    state: 'SAFE',
    action: 'NONE',
    buzzer: false,
    vibration: false,
    event: 'NONE'
  };

  function handleTelemetryUpdate(pos) {
    latestData.latitude = pos.lat;
    latestData.longitude = pos.lon;
    latestData.speed = pos.speed_kmh;
    latestData.heading = pos.heading_deg;
    latestData.battery = pos.battery_pct;
    latestData.sequence = pos.seq;
    latestData.satellites = pos.sats;
    renderUI();
  }

  function handleRiskUpdate(risk) {
    latestData.state = (risk.state || 'safe').toUpperCase();
    latestData.risk_score = risk.geofence_risk || 0;
    latestData.boundary_distance = risk.components?.boundary_distance || -1;
    latestData.buzzer = risk.components?.buzzer_on || false;
    latestData.action = latestData.state === 'HIGH_RISK' ? 'SHOCK' : latestData.state === 'WARNING' ? 'BUZZ' : 'NONE';
    latestData.risk_type = 'GEOFENCE';
    renderUI();
  }

  // --- REPLACE THE REST OF updateTelemetry WITH renderUI ---
  function renderUI() {
    const data = latestData;
    data.boundary_configured = boundaryData.configured;
    data.boundary_point_count = boundaryData.point_count;
"""

new_content = re.sub(r'async function updateTelemetry\(\).*', supabase_script, content, flags=re.DOTALL)
new_content += """
    // Copied from original logic
    setText("liveStatus", "● LIVE");
    setText("collarStatus", data.state === "SAFE" ? "● Active & Safe" : "● Warning");
    setText("collarId", "PASHU-A01 (Cloud)");
    setText("sequence", data.sequence);
    setText("latitude", number(data.latitude, 6));
    setText("longitude", number(data.longitude, 6));
    setText("speed", number(data.speed, 1) + " km/h");
    setText("heading", data.heading + "°");
    setText("satellites", data.satellites);
    setText("acceleration", number(data.acceleration, 2) + " g");
    setText("boundary", data.boundary_distance >= 0 ? number(data.boundary_distance, 1) + " m" : "—");
    setText("road", data.road_distance >= 0 ? number(data.road_distance, 1) + " m" : "—");
    setText("geofence", data.boundary_configured ? "Active · " + data.boundary_point_count + " points" : "Not configured");
    
    setText("risk", data.risk_score + " / 100");
    setText("type", data.risk_type);
    setText("state", data.state);
    setText("action", data.action);
    applyRiskStyle(data.risk_score);
    setText("decisionText", decisionDescription(data.action, data.risk_type));
    setText("buzzer", data.buzzer ? "ON" : "OFF");
    setText("vibration", data.vibration ? "ON" : "OFF");
    setText("event", data.event);
    setText("eventTime", new Date().toLocaleTimeString());
    setText("lastUpdate", new Date().toLocaleTimeString());
  }

  initSupabase();
</script>
</body>
</html>
"""

with open("scratch/cloud_telemetry.html", "w") as f:
    f.write(new_content)
