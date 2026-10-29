import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './store/auth';
import { Layout } from './components/Layout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Tickets from './pages/Tickets';
import TicketDetail from './pages/TicketDetail';
import MyWork from './pages/MyWork';
import Technicians from './pages/Technicians';
import Jobs from './pages/Jobs';
const Reports = lazy(() => import('./pages/Reports')); // pulls in the charting library only when opened
import Track from './pages/Track';
import MyDay from './pages/MyDay';
import TeamReport from './pages/TeamReport';
import Users from './pages/Users';
import Customers from './pages/Customers';
import Settings from './pages/Settings';
import type { Role } from './api/types';

function Guard({ children }: { children: React.ReactNode }) {
  const token = useAuth((s) => s.token);
  return token ? <>{children}</> : <Navigate to="/login" replace />;
}

function Home() {
  const user = useAuth((s) => s.user);
  return user?.role === 'TECHNICIAN' ? <Navigate to="/my-work" replace /> : <Dashboard />;
}

/** Re-creates the Tickets page when the filters in the address change (e.g. a dashboard card was clicked). */
function TicketsRoute() {
  const { search } = useLocation();
  return <Tickets key={search} />;
}

function Only({ roles, children }: { roles: Role[]; children: React.ReactNode }) {
  const user = useAuth((s) => s.user);
  return user && roles.includes(user.role) ? <>{children}</> : <Navigate to="/" replace />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/track/:token" element={<Track />} />
      <Route element={<Guard><Layout /></Guard>}>
        <Route index element={<Home />} />
        <Route path="tickets" element={<TicketsRoute />} />
        <Route path="tickets/:id" element={<TicketDetail />} />
        <Route path="my-work" element={<Only roles={['TECHNICIAN']}><MyWork /></Only>} />
        <Route path="my-day" element={<Only roles={['TECHNICIAN']}><MyDay /></Only>} />
        <Route path="team-report" element={<Only roles={['SUPERVISOR', 'ADMIN']}><TeamReport /></Only>} />
        <Route path="admin/users" element={<Only roles={['ADMIN']}><Users /></Only>} />
        <Route path="admin/settings" element={<Only roles={['SUPERVISOR', 'ADMIN']}><Settings /></Only>} />
        <Route path="customers" element={<Only roles={['OPERATOR', 'SUPERVISOR', 'ADMIN']}><Customers /></Only>} />
        <Route path="technicians" element={<Only roles={['OPERATOR', 'SUPERVISOR', 'ADMIN']}><Technicians /></Only>} />
        <Route path="jobs" element={<Only roles={['SUPERVISOR', 'ADMIN']}><Jobs /></Only>} />
        <Route path="reports" element={<Only roles={['SUPERVISOR', 'ADMIN']}><Suspense fallback={<div className="skeleton h-64" />}><Reports /></Suspense></Only>} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
