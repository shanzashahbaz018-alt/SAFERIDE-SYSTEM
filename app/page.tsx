
"use client";

import { useState, useEffect, useRef } from "react";

type Point = [number, number];

type Incident = {
  id: number;
  title: string;
  detail: string;
  severity: string;
  status: string;
  time: string;
};

export default function SafeRide() {
  const mapRef = useRef<any>(null);
  const carRef = useRef<any>(null);
  const routeRef = useRef<any>(null);
  const deviationRef = useRef<any>(null);
  const gpsMarkerRef = useRef<any>(null);

  const routePointsRef = useRef<Point[]>([]);
  const rideTimerRef = useRef<any>(null);
  const callTimerRef = useRef<any>(null);
  const gpsWatchRef = useRef<any>(null);
  const progressRef = useRef(0);
  const deviationCountRef = useRef(0);
  const alertRef = useRef(false);
  const safeRef = useRef(false);
  const incidentIdRef = useRef(0);
  const activeIncidentIdRef = useRef<number | null>(null);

  const [view, setView] = useState<"passenger" | "control">("passenger");
  const [ride, setRide] = useState(false);
  const [alert, setAlert] = useState(false);
  const [calls, setCalls] = useState(0);
  const [safe, setSafe] = useState(false);
  const [sos, setSos] = useState(false);
  const [mapReady, setMapReady] = useState(false);
  const [routeReady, setRouteReady] = useState(false);
  const [gpsActive, setGpsActive] = useState(false);
  const [gpsStatus, setGpsStatus] = useState("GPS disconnected");
  const [coordinates, setCoordinates] = useState<Point | null>(null);
  const [distance, setDistance] = useState(0);
  const [threshold, setThreshold] = useState(150);
  const [incident, setIncident] = useState<Incident | null>(null);
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [log, setLog] = useState<string[]>(["SafeRide initialized."]);

  const start: Point = [33.7015, 73.0352];
  const end: Point = [33.7077, 73.0551];

  function addLog(message: string) {
    setLog((previous) => [
      new Date().toLocaleTimeString() + " — " + message,
      ...previous,
    ]);
  }

  function setAlertState(value: boolean) {
    alertRef.current = value;
    setAlert(value);
  }

  function setSafeState(value: boolean) {
    safeRef.current = value;
    setSafe(value);
  }

  function clearTimers() {
    clearInterval(rideTimerRef.current);
    clearTimeout(callTimerRef.current);
    rideTimerRef.current = null;
    callTimerRef.current = null;
  }

  function stopGPS() {
    if (gpsWatchRef.current !== null && navigator.geolocation) {
      navigator.geolocation.clearWatch(gpsWatchRef.current);
      gpsWatchRef.current = null;
    }
    setGpsActive(false);
    setGpsStatus("GPS disconnected");
  }

  function distanceToRoute(point: Point, route: Point[]) {
    if (!route.length) return 0;

    const metersLat = 111320;
    const metersLng = 111320 * Math.cos((point[0] * Math.PI) / 180);
    let best = Infinity;

    for (const p of route) {
      const dy = (point[0] - p[0]) * metersLat;
      const dx = (point[1] - p[1]) * metersLng;
      best = Math.min(best, Math.sqrt(dx * dx + dy * dy));
    }

    return Math.round(best);
  }

  function createIncident(
    title: string,
    detail: string,
    severity = "HIGH"
  ) {
    const newIncident: Incident = {
      id: incidentIdRef.current + 1,
      title,
      detail,
      severity,
      status: "OPEN",
      time: new Date().toLocaleString(),
    };

    incidentIdRef.current = newIncident.id;
    activeIncidentIdRef.current = newIncident.id;

    setIncident(newIncident);
    setIncidents((previous) => [newIncident, ...previous]);

    addLog(`Incident #${newIncident.id} created: ${title}`);
    return newIncident;
  }

  function updateActiveIncident(status: string) {
    const id = activeIncidentIdRef.current;
    if (id === null) return;

    setIncident((previous) =>
      previous && previous.id === id ? { ...previous, status } : previous
    );

    setIncidents((previous) =>
      previous.map((item =>
        item.id === id ? { ...item, status } : item
      ))
    );
  }

  // Automatic safety-call and escalation timer
  useEffect(() => {
    clearTimeout(callTimerRef.current);

    if (!alert || safe || sos || calls < 1) return;

    if (calls < 3) {
      callTimerRef.current = setTimeout(() => {
        setCalls((previous) => {
          const next = previous + 1;
          addLog(`Safety call attempt ${next} — simulated unanswered.`);
          return next;
        });
      }, 10000);
    } else {
      callTimerRef.current = setTimeout(() => {
        setSos(true);
        updateActiveIncident("ESCALATED");
        addLog("Three calls unanswered. Escalation activated (demo only).");
      }, 10000);
    }

    return () => clearTimeout(callTimerRef.current);
  }, [alert, safe, sos, calls]);

  // Map initialization
  useEffect(() => {
    let cancelled = false;

    async function loadLeaflet() {
      if ((window as any).L) return;

      if (!document.querySelector('link[data-leaflet="true"]')) {
        const link = document.createElement("link");
        link.rel = "stylesheet";
        link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
        link.dataset.leaflet = "true";
        document.head.appendChild(link);
      }

      await new Promise<void>((resolve, reject) => {
        const existing = document.getElementById("saferide-leaflet-script") as HTMLScriptElement | null;

        if (existing) {
          existing.addEventListener("load", () => resolve(), { once: true });
          existing.addEventListener("error", () => reject(new Error("Leaflet load failed")), { once: true });

          if ((window as any).L) resolve();
          return;
        }

        const script = document.createElement("script");
        script.id = "saferide-leaflet-script";
        script.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
        script.onload = () => resolve();
        script.onerror = () => reject(new Error("Leaflet load failed"));
        document.head.appendChild(script);
      });
    }

    async function initializeMap() {
      await loadLeaflet();

      if (cancelled || mapRef.current) return;

      const L = (window as any).L;
      const map = L.map("saferide-map").setView(start, 14);
      mapRef.current = map;

      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "&copy; OpenStreetMap contributors",
      }).addTo(map);

      carRef.current = L.marker(start).addTo(map).bindPopup("SafeRide vehicle");
      L.marker(start).addTo(map).bindPopup("Pickup — F-9 Markaz");
      L.marker(end).addTo(map).bindPopup("Destination — Blue Area");

      try {
        const url =
          `https://router.project-osrm.org/route/v1/driving/` +
          `${start[1]},${start[0]};${end[1]},${end[0]}?overview=full&geometries=geojson`;

        const response = await fetch(url);
        if (!response.ok) throw new Error("Routing request failed");

        const data = await response.json();
        if (cancelled) return;

        const routeCoordinates = data.routes?.[0]?.geometry?.coordinates;

        if (!routeCoordinates) throw new Error("No route found");

        const points: Point[] = routeCoordinates.map(
          (p: number[]) => [p[1], p[0]]
        );

        routePointsRef.current = points;

        routeRef.current = L.polyline(points, {
          color: "#34d399",
          weight: 6,
        }).addTo(map);

        map.fitBounds(routeRef.current.getBounds(), { padding: [25, 25] });
        setRouteReady(true);
      } catch {
        if (cancelled) return;

        routePointsRef.current = [start, end];

        routeRef.current = L.polyline([start, end], {
          color: "#34d399",
          dashArray: "8 8",
          weight: 5,
        }).addTo(map);

        map.fitBounds([start, end]);
        addLog("Routing service unavailable; fallback route displayed.");
      }

      if (!cancelled) setMapReady(true);
    }

    initializeMap().catch(() => {
      if (!cancelled) addLog("Map failed to load. Check your internet connection.");
    });

    return () => {
      cancelled = true;
      clearTimers();

      if (gpsWatchRef.current !== null && navigator.geolocation) {
        navigator.geolocation.clearWatch(gpsWatchRef.current);
        gpsWatchRef.current = null;
      }

      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, []);

  // Refresh map size when dashboard tab changes
  useEffect(() => {
    const timer = setTimeout(() => {
      mapRef.current?.invalidateSize();
    }, 250);

    return () => clearTimeout(timer);
  }, [view]);

  function triggerAlert(meters: number) {
    if (alertRef.current || safeRef.current) return;

    clearInterval(rideTimerRef.current);
    rideTimerRef.current = null;

    setAlertState(true);
    setDistance(meters);
    setCalls(1);
    deviationCountRef.current = 0;

    addLog(`Route deviation detected: ${meters}m from route.`);
    addLog("Safety call attempt 1 started (simulation).");

    createIncident(
      "Route deviation detected",
      `${meters}m from the planned route. Passenger safety verification initiated.`
    );
  }

  function startDemoRide() {
    if (!mapReady || routePointsRef.current.length === 0) {
      addLog("Wait for the map and route to load.");
      return;
    }

    if (gpsActive) {
      addLog("Stop GPS mode before starting a demo ride.");
      return;
    }

    clearTimers();

    progressRef.current = 0;
    setRide(true);
    setAlertState(false);
    setSafeState(false);
    setSos(false);
    setCalls(0);
    setDistance(0);
    setIncident(null);
    activeIncidentIdRef.current = null;
    deviationCountRef.current = 0;

    deviationRef.current?.remove();
    deviationRef.current = null;
    carRef.current?.setLatLng(routePointsRef.current[0]);

    addLog("Demo ride started. Route monitoring active.");

    rideTimerRef.current = setInterval(() => {
      const route = routePointsRef.current;
      if (!route.length || alertRef.current) return;

      progressRef.current++;
      if (progressRef.current >= route.length) progressRef.current = 0;

      const point = route[progressRef.current];
      carRef.current?.setLatLng(point);
      mapRef.current?.panTo(point);
      setDistance(0);
    }, 1200);
  }

  function simulateDeviation() {
    if (!ride) {
      addLog("Start the demo ride before simulating deviation.");
      return;
    }

    if (alertRef.current) {
      addLog("An active alert already exists.");
      return;
    }

    clearInterval(rideTimerRef.current);

    const route = routePointsRef.current;
    const point = route[Math.floor(route.length * 0.6)] || start;
    const offPoint: Point = [point[0] + 0.012, point[1] + 0.012];

    carRef.current?.setLatLng(offPoint);
    mapRef.current?.panTo(offPoint);

    deviationRef.current?.remove();

    deviationRef.current = (window as any).L.circle(offPoint, {
      radius: 250,
      color: "#fb7185",
      fillOpacity: 0.2,
    }).addTo(mapRef.current);

    const meters = distanceToRoute(offPoint, route);
    setDistance(meters);
    triggerAlert(meters);
  }

  function startGPS() {
    if (!navigator.geolocation) {
      setGpsStatus("Geolocation not supported by this browser.");
      addLog("Browser does not support geolocation.");
      return;
    }

    if (gpsWatchRef.current !== null) {
      addLog("GPS is already active.");
      return;
    }

    if (!mapReady) {
      addLog("Wait for the map to load.");
      return;
    }

    clearTimers();
    setRide(true);
    setAlertState(false);
    setSafeState(false);
    setSos(false);
    setCalls(0);
    setDistance(0);
    setIncident(null);
    activeIncidentIdRef.current = null;
    setGpsActive(true);
    setGpsStatus("Waiting for GPS permission…");

    addLog("Real GPS requested from this browser.");

    gpsWatchRef.current = navigator.geolocation.watchPosition(
      (position) => {
        const point: Point = [
          position.coords.latitude,
          position.coords.longitude,
        ];

        setCoordinates(point);
        setGpsStatus(`GPS active · accuracy ${Math.round(position.coords.accuracy)}m`);

        carRef.current?.setLatLng(point);
        mapRef.current?.panTo(point);

        const L = (window as any).L;

        if (!gpsMarkerRef.current && L && mapRef.current) {
          gpsMarkerRef.current = L.circleMarker(point, {
            radius: 8,
            color: "#60a5fa",
            fillColor: "#60a5fa",
            fillOpacity: 1,
          }).addTo(mapRef.current);
        } else {
          gpsMarkerRef.current?.setLatLng(point);
        }

        const meters = distanceToRoute(point, routePointsRef.current);
        setDistance(meters);

        if (!alertRef.current && meters > threshold) {
          deviationCountRef.current++;

          if (deviationCountRef.current >= 3) {
            triggerAlert(meters);
          }
        } else if (meters <= threshold) {
          deviationCountRef.current = 0;
        }
      },
      (error) => {
        setGpsStatus("GPS error: " + error.message);
        addLog("GPS error: " + error.message);
        stopGPS();
      },
      {
        enableHighAccuracy: true,
        maximumAge: 2000,
        timeout: 15000,
      }
    );
  }

  function passengerSafe() {
    if (!alertRef.current) return;

    setSafeState(true);
    setAlertState(false);
    setSos(false);
    setCalls(0);
    updateActiveIncident("PASSENGER SAFE");
    addLog("Passenger confirmed safe. Calls and escalation cancelled.");
  }

  function emergency() {
    setSafeState(false);
    setSos(true);
    setAlertState(true);

    addLog("SOS activated. Simulation only — no authorities contacted.");

    if (activeIncidentIdRef.current === null) {
      createIncident("Passenger SOS", "Manual SOS activated by passenger.", "CRITICAL");
    } else {
      updateActiveIncident("ESCALATED");
    }
  }

  function acknowledgeIncident() {
    if (!incident || incident.status === "RESOLVED") return;

    updateActiveIncident("ACKNOWLEDGED");
    addLog(`Control Center acknowledged incident #${incident.id}.`);
  }

  function resolveIncident() {
    if (!incident || incident.status === "RESOLVED") return;

    updateActiveIncident("RESOLVED");
    setAlertState(false);
    setSafeState(true);
    setSos(false);
    setCalls(0);
    addLog(`Incident #${incident.id} resolved by operator.`);
  }

  function endRide() {
    clearTimers();
    stopGPS();
    setRide(false);
    addLog("Ride ended. Monitoring stopped.");
  }

  function resetDemo() {
    clearTimers();
    stopGPS();

    progressRef.current = 0;
    deviationCountRef.current = 0;
    activeIncidentIdRef.current = null;
    incidentIdRef.current = 0;

    setRide(false);
    setAlertState(false);
    setSafeState(false);
    setCalls(0);
    setSos(false);
    setDistance(0);
    setCoordinates(null);
    setGpsStatus("GPS disconnected");
    setIncident(null);
    setIncidents([]);

    deviationRef.current?.remove();
    deviationRef.current = null;
    gpsMarkerRef.current?.remove();
    gpsMarkerRef.current = null;

    if (routePointsRef.current.length && carRef.current && mapRef.current) {
      carRef.current.setLatLng(routePointsRef.current[0]);
      mapRef.current.setView(start, 14);
    }

    addLog("Demo reset.");
  }

  const status = sos
    ? "ESCALATED"
    : safe
    ? "PASSENGER SAFE"
    : alert
    ? "ROUTE ALERT"
    : ride
    ? "MONITORING"
    : "STANDBY";

  const panel: React.CSSProperties = {
    background: "#142238",
    border: "1px solid #273b58",
    borderRadius: 16,
    padding: 16,
    margin: "16px 0",
  };

  const buttonStyle = (bg: string, fg = "#fff"): React.CSSProperties => ({
    background: bg,
    color: fg,
    border: "none",
    borderRadius: 10,
    padding: "12px 14px",
    fontWeight: 700,
    cursor: "pointer",
  });

  const metric = (title: string, value: string) => (
    <div key={title} style={{
      background: "#142238",
      border: "1px solid #273b58",
      borderRadius: 13,
      padding: 14,
    }}>
      <div style={{ color: "#98a9c2", fontSize: 11 }}>{title}</div>
      <div style={{ fontSize: 18, fontWeight: 800, marginTop: 7 }}>{value}</div>
    </div>
  );

  return (
    <main style={{
      background: "#0a1220",
      color: "#f4f7fb",
      minHeight: "100vh",
      padding: 16,
      fontFamily: "Arial",
    }}>
      <div style={{ maxWidth: 1100, margin: "auto" }}>
        <header style={{ padding: "10px 0 20px" }}>
          <div style={{ color: "#34d399", fontSize: 12, fontWeight: 800, letterSpacing: 2 }}>
            RIDE SAFETY PLATFORM
          </div>
          <h1 style={{ fontSize: 32, margin: "8px 0" }}>🛡 SafeRide AI</h1>
          <p style={{ color: "#9aabc4" }}>
            Passenger protection · Ride monitoring · Incident management
          </p>
        </header>

        <nav style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 18 }}>
          <button onClick={() => setView("passenger")} style={buttonStyle(view === "passenger" ? "#16865c" : "#273b58")}>
            Passenger App
          </button>
          <button onClick={() => setView("control")} style={buttonStyle(view === "control" ? "#2563eb" : "#273b58")}>
            Control Center
          </button>
          <button onClick={resetDemo} style={buttonStyle("#475569")}>
            Reset Demo
          </button>
        </nav>

        {/* Metrics */}
        <section style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
          gap: 10,
        }}>
          {metric("RIDE STATUS", ride ? "ACTIVE" : "INACTIVE")}
          {metric("SAFETY", status)}
          {metric("DEVIATION", `${distance} m`)}
          {metric("CALLS", `${calls} / 3`)}
          {metric("GPS", gpsActive ? "CONNECTED" : "OFF")}
          {metric("INCIDENT", incident ? incident.status : "NONE")}
        </section>

        {/* Map */}
        <section style={{ ...panel, padding: 0, overflow: "hidden" }}>
          <div style={{
            padding: 15,
            display: "flex",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: 8,
          }}>
            <strong>Live Ride Map</strong>
            <span style={{ color: routeReady ? "#34d399" : "#fbbf24", fontSize: 13 }}>
              {routeReady ? "● Route loaded" : "● Loading map"}
            </span>
          </div>
          <div id="saferide-map" style={{ height: 400, width: "100%" }} />
          <div style={{ padding: 14, color: "#9aabc4", fontSize: 13 }}>
            F-9 Markaz → Blue Area · {mapReady ? "Map ready" : "Loading"}
          </div>
        </section>

        {/* Passenger View */}
        {view === "passenger" && (
          <>
            <section style={panel}>
              <h2 style={{ marginTop: 0 }}>Passenger Safety</h2>
              <p style={{ color: "#9aabc4", fontSize: 14 }}>
                Start a demo ride or use your phone GPS.
              </p>

              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                <button onClick={startDemoRide} style={buttonStyle("#10b981", "#062017")}>
                  ▶ Start demo ride
                </button>
                <button onClick={simulateDeviation} style={buttonStyle("#f59e0b", "#261800")}>
                  ⚠ Simulate deviation
                </button>
                <button onClick={startGPS} style={buttonStyle("#2563eb")}>
                  📍 Start GPS
                </button>
                <button onClick={stopGPS} style={buttonStyle("#475569")}>
                  Stop GPS
                </button>
                <button onClick={passengerSafe} disabled={!alert} style={buttonStyle("#0d74c7")}>
                  I'm safe
                </button>
                <button onClick={emergency} style={buttonStyle("#be3455")}>
                  SOS EMERGENCY
                </button>
                <button onClick={endRide} style={buttonStyle("#64748b")}>
                  End ride
                </button>
              </div>

              <div style={{ marginTop: 14, padding: 14, background: "#0a1220", borderRadius: 12 }}>
                <strong>{status}</strong>
                <p style={{ color: "#c0cde0", fontSize: 14, marginBottom: 0 }}>
                  {sos
                    ? "Emergency state active. No external responder has been contacted."
                    : alert
                    ? "Deviation detected. Safety verification sequence is running."
                    : safe
                    ? "Safety confirmed. Automated sequence stopped."
                    : ride
                    ? "Ride monitoring active."
                    : "System standby. Start a demo ride."}
                </p>
              </div>
            </section>

            <section style={panel}>
              <h3 style={{ marginTop: 0 }}>GPS Information</h3>
              <p>{gpsStatus}</p>
              {coordinates && (
                <p style={{ color: "#9aabc4", fontSize: 13 }}>
                  Latitude: {coordinates[0].toFixed(6)}<br />
                  Longitude: {coordinates[1].toFixed(6)}
                </p>
              )}
              <label>Deviation threshold: {threshold} metres</label>
              <input
                type="range"
                min={50}
                max={500}
                step={25}
                value={threshold}
                onChange={(e) => setThreshold(Number(e.target.value))}
                style={{ width: "100%" }}
              />
              <div style={{ display: "flex", justifyContent: "space-between", color: "#9aabc4", fontSize: 12 }}>
                <span>50m</span><span>500m</span>
              </div>
            </section>
          </>
        )}

        {/* Control Center */}
        {view === "control" && (
          <>
            <section style={panel}>
              <h2 style={{ marginTop: 0 }}>SafeRide Control Center</h2>
              <p style={{ color: "#9aabc4", fontSize: 14 }}>
                Operator dashboard for acknowledging and resolving safety incidents.
              </p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                <button onClick={acknowledgeIncident} disabled={!incident || incident.status === "RESOLVED"} style={buttonStyle("#2563eb")}>
                  Acknowledge incident
                </button>
                <button onClick={resolveIncident} disabled={!incident || incident.status === "RESOLVED"} style={buttonStyle("#10b981", "#062017")}>
                  Resolve incident
                </button>
              </div>
            </section>

            <section style={panel}>
              <h3 style={{ marginTop: 0 }}>Current Incident</h3>
              {incident ? (
                <div style={{ background: "#0a1220", padding: 14, borderRadius: 12 }}>
                  <h3>Incident #{incident.id} — {incident.title}</h3>
                  <p>{incident.detail}</p>
                  <p>Severity: <strong>{incident.severity}</strong></p>
                  <p>Status: <strong>{incident.status}</strong></p>
                  <p style={{ color: "#9aabc4", fontSize: 12 }}>{incident.time}</p>
                  <p style={{ color: "#fca5a5", fontSize: 13 }}>
                    Demo only. No calls or dispatches are sent.
                  </p>
                </div>
              ) : (
                <p style={{ color: "#9aabc4" }}>
                  No active incident. Trigger a deviation or SOS in the Passenger App.
                </p>
              )}
            </section>

            <section style={panel}>
              <h3 style={{ marginTop: 0 }}>Incident Queue</h3>
              {incidents.length === 0 ? (
                <p style={{ color: "#9aabc4" }}>No incidents recorded yet.</p>
              ) : (
                incidents.map((item) => (
                  <div key={item.id} style={{
                    background: "#0a1220",
                    border: "1px solid #354a66",
                    borderRadius: 12,
                    padding: 12,
                    marginBottom: 10,
                  }}>
                    <strong>#{item.id} — {item.title}</strong>
                    <p style={{ fontSize: 13, color: "#b8c7d9" }}>{item.detail}</p>
                    <div style={{ fontSize: 12, color: "#9aabc4" }}>
                      Severity: {item.severity} · Status: {item.status}
                    </div>
                    <div style={{ fontSize: 12, color: "#9aabc4", marginTop: 5 }}>
                      {item.time}
                    </div>
                  </div>
                ))
              )}
            </section>
          </>
        )}

        {/* Activity Log */}
        <section style={panel}>
          <h3 style={{ marginTop: 0 }}>Activity Timeline</h3>
          <div style={{ maxHeight: 260, overflow: "auto" }}>
            {log.map((entry, index) => (
              <div key={index} style={{ padding: "9px 0", borderBottom: "1px solid #273b58", fontSize: 13 }}>
                {entry}
              </div>
            ))}
          </div>
        </section>

        <footer style={{ textAlign: "center", color: "#8193ab", padding: 18, fontSize: 12, lineHeight: 1.7 }}>
          SafeRide AI · Prototype<br />
          GPS & route monitoring demonstration<br />
          Calls, inDrive connectivity, cloud and emergency dispatch are not connected.
        </footer>
      </div>
    </main>
  );
}
