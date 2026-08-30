import { Suspense, lazy, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';

import { PublicAnimalPage } from './screens/PublicAnimalPage.tsx';
import { AuthScreen } from './screens/AuthScreen.tsx';
import { OnboardingScreen } from './screens/OnboardingScreen.tsx';
import { IntroScreen } from './screens/IntroScreen.tsx';
import { DangerHost } from './components/DangerHost.tsx';
import { TabBar } from './components/TabBar.tsx';
import { HerdProvider } from './lib/useHerd.tsx';
import { AuthProvider, useAuth } from './lib/auth.tsx';

/**
 * Map screens pull Leaflet (~288 kB). The public tag page must load in under
 * 2 s on 3G and never renders a map, so it must not pay for one.
 */
const HomeScreen = lazy(() =>
  import('./screens/HomeScreen.tsx').then((m) => ({ default: m.HomeScreen })));
const AnimalsScreen = lazy(() =>
  import('./screens/AnimalsScreen.tsx').then((m) => ({ default: m.AnimalsScreen })));
const LiveScreen = lazy(() =>
  import('./screens/LiveScreen.tsx').then((m) => ({ default: m.LiveScreen })));
const AlertsScreen = lazy(() =>
  import('./screens/AlertsScreen.tsx').then((m) => ({ default: m.AlertsScreen })));
const ProfileScreen = lazy(() =>
  import('./screens/ProfileScreen.tsx').then((m) => ({ default: m.ProfileScreen })));
const FieldsScreen = lazy(() =>
  import('./screens/FieldsScreen.tsx').then((m) => ({ default: m.FieldsScreen })));
const InsightsScreen = lazy(() =>
  import('./screens/InsightsScreen.tsx').then((m) => ({ default: m.InsightsScreen })));
const LiveTrackingScreen = lazy(() =>
  import('./screens/LiveTrackingScreen.tsx').then((m) => ({ default: m.LiveTrackingScreen })));
const AnimalDetailScreen = lazy(() =>
  import('./screens/AnimalDetailScreen.tsx').then((m) => ({ default: m.AnimalDetailScreen })));
const AddAnimalScreen = lazy(() =>
  import('./screens/AddAnimalScreen.tsx').then((m) => ({ default: m.AddAnimalScreen })));
const SettingsScreen = lazy(() =>
  import('./screens/SettingsScreen.tsx').then((m) => ({ default: m.SettingsScreen })));
const DeviceDetailsScreen = lazy(() =>
  import('./screens/DeviceDetailsScreen.tsx').then((m) => ({ default: m.DeviceDetailsScreen })));

/**
 * The stage. On a phone the frame IS the screen. On a desktop the app keeps
 * its one-handed column centred on a dark ground rather than stretching into
 * 1600px-wide cards that no farmer will ever see.
 */
function Stage({ children }: { children: React.ReactNode }) {
  return (
    <div className="app-stage">
      <div className="app-frame">{children}</div>
    </div>
  );
}

/**
 * Three states, in order:
 *   no session       -> sign in
 *   session, no farm -> name the farm (every RLS policy needs that row)
 *   both             -> the app
 */
function Gated({ children }: { children: React.ReactNode }) {
  const { session, loading, needsProfile } = useAuth();
  if (loading) {
    return (
      <Stage>
        <div className="grid h-full place-items-center" style={{ background: 'var(--bg)' }}>
          <div className="skeleton" style={{ width: 44, height: 44, borderRadius: 999 }} />
        </div>
      </Stage>
    );
  }
  if (!session) return <Stage><AuthScreen /></Stage>;
  if (needsProfile) return <Stage><OnboardingScreen /></Stage>;
  return <>{children}</>;
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <Gated>
      <HerdProvider>
        <Stage>
          <div className="flex h-full flex-col" style={{ background: 'var(--bg)' }}>
            <div className="relative min-h-0 flex-1">{children}</div>
            <TabBar />
          </div>
        </Stage>
      </HerdProvider>
    </Gated>
  );
}

/**
 * The danger takeover mounts everywhere EXCEPT the public tag page. A stranger
 * who scanned an ear tag is not the farmer and must never be shown another
 * person's herd emergency.
 */
function DangerGate() {
  const { pathname } = useLocation();
  if (pathname.startsWith('/a/')) return null;
  return <DangerHost />;
}

export default function App() {
  // The intro covers a real wait — session restore and the first herd fetch —
  // and is shown once per app launch, not on every route change.
  const [intro, setIntro] = useState(() => !sessionStorage.getItem('herdwise.introShown'));

  /*
   * The app mounts UNDERNEATH the intro, not after it.
   *
   * Returning the intro instead of the app meant nothing was behind it: the
   * clip faded out to an empty stage, then React swapped in the app, which
   * then had to restore the session, fetch the herd, pull the Leaflet chunk
   * and decode the backdrop — so the storm dissolved into a flash of blank
   * page followed by a loading skeleton.
   *
   * Rendering both at once turns that dead time into the intro's runtime. By
   * the time the overlay dissolves the dashboard behind it is already drawn,
   * showing the same photograph in the same place, so the storm never leaves
   * the screen — only the wordmark does.
   */
  return (
    <AuthProvider>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>

      {intro && (
        <div className="intro-over">
          <Stage>
            <IntroScreen onDone={() => {
              sessionStorage.setItem('herdwise.introShown', '1');
              setIntro(false);
            }} />
          </Stage>
        </div>
      )}
    </AuthProvider>
  );
}

function AppRoutes() {
  return (
    <>
      <DangerGate />
      <Suspense fallback={
        <Stage>
          <div className="h-full px-5 pt-6" style={{ background: 'var(--bg)' }}>
            <div className="skeleton mb-3" style={{ height: 34, width: '50%', borderRadius: 10 }} />
            <div className="skeleton" style={{ height: 140, borderRadius: 22 }} />
          </div>
        </Stage>
      }>
        <Routes>
          {/* No shell, no realtime, no map. Must stay lean. */}
          <Route path="/a/:slug" element={<PublicAnimalPage />} />

          <Route path="/"         element={<Shell><HomeScreen /></Shell>} />
          <Route path="/animals"  element={<Shell><AnimalsScreen /></Shell>} />
          <Route path="/map"      element={<Shell><LiveScreen /></Shell>} />
          <Route path="/alerts"   element={<Shell><AlertsScreen /></Shell>} />
          <Route path="/profile"  element={<Shell><ProfileScreen /></Shell>} />

          <Route path="/fields"      element={<Shell><FieldsScreen /></Shell>} />
          <Route path="/insights"    element={<Shell><InsightsScreen /></Shell>} />
          <Route path="/animals/new" element={<Shell><AddAnimalScreen /></Shell>} />
          <Route path="/animal/:id"  element={<Shell><AnimalDetailScreen /></Shell>} />
          <Route path="/device/:id"  element={<Shell><DeviceDetailsScreen /></Shell>} />
          {/* Full-bleed: the trail IS the screen, so no tab bar underneath.
              Still needs HerdProvider — the pin colours itself from the same
              risk state as the dashboard. */}
          <Route path="/live/:id"    element={
            <Gated><HerdProvider><Stage><LiveTrackingScreen /></Stage></HerdProvider></Gated>} />
          <Route path="/settings"    element={<Shell><SettingsScreen /></Shell>} />

          {/* Old paths keep working so a bookmark never dead-ends. */}
          <Route path="/herd" element={<Navigate to="/animals" replace />} />
          <Route path="/live" element={<Navigate to="/map" replace />} />
          <Route path="/more" element={<Navigate to="/profile" replace />} />
          <Route path="/zones" element={<Navigate to="/fields" replace />} />
          <Route path="*"     element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </>
  );
}
