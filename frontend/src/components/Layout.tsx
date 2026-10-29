import { BarChart3, ClipboardList, Cpu, Gauge, HardHat, KeyRound, LogOut, Moon, Plus, Settings2, Sun, Ticket as TicketIcon, UserCog, Users, Wrench, CalendarCheck, Contact } from 'lucide-react';
import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import clsx from 'clsx';
import { useAuth, isManager, isStaff } from '../store/auth';
import { useUi } from '../store/ui';
import { useData } from '../store/data';
import { useRealtime } from '../hooks/useBootstrap';
import { ConnectionBadge } from './ConnectionBadge';
import { Avatar } from './Badges';
import { Toasts } from './Toasts';
import { NewTicketDrawer } from './NewTicketDrawer';
import { ChangePasswordDialog } from './ChangePasswordDialog';

export function Layout() {
  useRealtime();
  const user = useAuth((s) => s.user)!;
  const logout = useAuth((s) => s.logout);
  const theme = useUi((s) => s.theme);
  const toggleTheme = useUi((s) => s.toggleTheme);
  const online = useData((s) => s.online);
  const staff = isStaff(user);
  const manager = isManager(user);
  const admin = user.role === 'ADMIN';
  const [pwOpen, setPwOpen] = useState(false);
  const { pathname } = useLocation();

  // A new page always starts at the top, so the header is visible (before, a page opened from the lower part of the dashboard kept that scroll position).
  useEffect(() => { window.scrollTo(0, 0); }, [pathname]);

  useEffect(() => { document.documentElement.classList.toggle('light', theme === 'light'); document.documentElement.classList.toggle('dark', theme === 'dark'); }, [theme]);

  type Item = { to: string; icon: typeof Gauge; label: string; end: boolean };
  const groups: { label: string; items: Item[] }[] = [
    {
      label: 'Operations',
      items: [
        ...(staff ? [{ to: '/', icon: Gauge, label: 'Command', end: true }] : [{ to: '/my-work', icon: Wrench, label: 'My work', end: false }, { to: '/my-day', icon: CalendarCheck, label: 'My day', end: false }]),
        { to: '/tickets', icon: TicketIcon, label: 'Tickets', end: false },
        ...(staff ? [{ to: '/customers', icon: Contact, label: 'Customers', end: false }, { to: '/technicians', icon: Users, label: 'Team', end: false }] : []),
        ...(manager ? [{ to: '/jobs', icon: Cpu, label: 'Jobs', end: false }] : []),
      ],
    },
    ...(manager ? [{ label: 'Insights', items: [{ to: '/team-report', icon: ClipboardList, label: 'Day reports', end: false }, { to: '/reports', icon: BarChart3, label: 'Reports', end: false }] }] : []),
    ...(manager ? [{ label: 'Admin', items: [...(admin ? [{ to: '/admin/users', icon: UserCog, label: 'Users', end: false }] : []), { to: '/admin/settings', icon: Settings2, label: 'Settings', end: false }] }] : []),
  ];
  const nav = groups.flatMap((g) => g.items);

  return (
    <div className="flex min-h-full">
      <aside className="sticky top-0 hidden h-screen w-56 shrink-0 flex-col border-r border-line bg-panel/80 p-3 backdrop-blur md:flex">
        <div className="mb-5 flex items-center gap-2 px-2 pt-1"><span className="grid h-8 w-8 place-items-center rounded-lg bg-brand/15 text-brand"><HardHat className="h-5 w-5" /></span><span className="text-lg font-bold tracking-tight">Tick<span className="text-brand">o</span></span></div>
        <nav className="flex flex-1 flex-col gap-4 overflow-y-auto">
          {groups.map((g) => (
            <div key={g.label}>
              <p className="mb-1 px-3 text-[10px] font-semibold uppercase tracking-wider text-mute/70">{g.label}</p>
              <div className="flex flex-col gap-0.5">
                {g.items.map((n) => (
                  <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => clsx('flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition', isActive ? 'bg-brand/15 text-brand' : 'text-mute hover:bg-panel2 hover:text-ink')}>
                    <n.icon className="h-4 w-4" />{n.label}
                  </NavLink>
                ))}
              </div>
            </div>
          ))}
        </nav>
        <div className="space-y-2 border-t border-line pt-3">
          <div className="flex items-center gap-2 px-1"><Avatar name={user.name} /><div className="min-w-0 text-xs"><p className="truncate font-semibold">{user.name}</p><p className="text-mute">{user.role.toLowerCase()}</p></div></div>
          <button className="btn-ghost w-full !justify-start text-xs" onClick={() => setPwOpen(true)}><KeyRound className="h-3.5 w-3.5" />Change password</button>
          <button className="btn-ghost w-full !justify-start text-xs" onClick={logout}><LogOut className="h-3.5 w-3.5" />Sign out</button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col pb-16 md:pb-0">
        <header className="sticky top-0 z-30 flex items-center justify-between gap-2 border-b border-line bg-bg/80 px-3 py-2.5 backdrop-blur md:px-6">
          <div className="flex items-center gap-2 md:hidden"><HardHat className="h-5 w-5 text-brand" /><span className="font-bold">Tick<span className="text-brand">o</span></span></div>
          <div className="hidden items-center gap-3 md:flex"><ConnectionBadge />{staff && <span className="text-xs text-mute">{online.length} online</span>}</div>
          <div className="flex items-center gap-2">
            <span className="md:hidden"><ConnectionBadge /></span>
            <button className="btn-ghost !p-2" onClick={toggleTheme} aria-label="Toggle theme">{theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}</button>
            {staff && <button className="btn-primary" onClick={() => useUi.getState().openNewTicket(true)}><Plus className="h-4 w-4" /><span className="hidden sm:inline">New ticket</span></button>}
            <button className="btn-ghost !p-2 md:hidden" onClick={() => setPwOpen(true)} aria-label="Change password"><KeyRound className="h-4 w-4" /></button>
            <button className="btn-ghost !p-2 md:hidden" onClick={logout} aria-label="Sign out"><LogOut className="h-4 w-4" /></button>
          </div>
        </header>
        <main className="flex-1 p-3 md:p-6"><Outlet /></main>
      </div>

      <nav className="fixed inset-x-0 bottom-0 z-40 flex overflow-x-auto border-t border-line bg-panel/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden" aria-label="Main">
        {nav.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => clsx('flex min-w-[64px] flex-1 flex-col items-center gap-0.5 py-2 text-[10px]', isActive ? 'text-brand' : 'text-mute')}><n.icon className="h-5 w-5" />{n.label}</NavLink>
        ))}
      </nav>
      <ChangePasswordDialog open={pwOpen} onClose={() => setPwOpen(false)} />
      <Toasts />
      {staff && <NewTicketDrawer />}
    </div>
  );
}
