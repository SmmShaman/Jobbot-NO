
import React, { useState } from 'react';
import { Sidebar } from './components/Sidebar';
import { DashboardPage } from './pages/DashboardPage';
import { JobsPage } from './pages/JobsPage';
import { SettingsPage } from './pages/SettingsPage';
import { ActivityLog } from './components/ActivityLog';
import { ClientProfilePage } from './pages/ClientProfilePage';
import { LoginPage } from './pages/LoginPage';
import { AdminUsersPage } from './pages/AdminUsersPage'; // New Import
import { LayoutDashboard, Briefcase, Activity, Settings, User, Shield } from 'lucide-react';
import { LanguageProvider, useLanguage } from './contexts/LanguageContext';
import { AuthProvider, useAuth } from './contexts/AuthContext';

// Inner App component
const MainLayout: React.FC = () => {
  const [currentPage, setCurrentPage] = useState('dashboard');
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const { t } = useLanguage();
  const { user, role } = useAuth();

  // Auth Guard
  if (!user) {
    return <LoginPage />;
  }

  const renderPage = () => {
    switch (currentPage) {
      case 'dashboard':
        return <DashboardPage />;
      case 'jobs':
        return <JobsPage setSidebarCollapsed={setIsSidebarCollapsed} />;
      case 'settings':
        return <SettingsPage />;
      case 'activity':
        return <ActivityLog />;
      case 'profile':
        return <ClientProfilePage />;
      case 'admin': // Protected Admin Route
        if (role !== 'admin') return <DashboardPage />;
        return <AdminUsersPage />;
      default:
        return <DashboardPage />;
    }
  };

  const navItems = [
    { id: 'dashboard', label: t('nav.dashboard'), icon: LayoutDashboard },
    { id: 'jobs', label: t('nav.jobs'), icon: Briefcase },
    { id: 'activity', label: t('nav.activity'), icon: Activity },
    { id: 'settings', label: t('nav.settings'), icon: Settings },
    { id: 'profile', label: t('nav.account'), icon: User },
  ];

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans pb-24 md:pb-8">
      <Sidebar 
        currentPage={currentPage} 
        onNavigate={setCurrentPage} 
        isCollapsed={isSidebarCollapsed}
        onToggleCollapse={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
      />
      
      <main 
        className={`transition-all duration-300 ease-in-out p-4 md:p-8 max-w-[1920px] mx-auto ${
          isSidebarCollapsed ? 'md:ml-20' : 'md:ml-64'
        }`}
      >
        {renderPage()}
      </main>

      {/* Mobile Bottom Navigation Bar */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 z-50 px-6 py-3 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)] safe-area-pb">
        <nav className="flex justify-between items-center">
          {navItems.slice(0, 5).map((item) => (
            <button
              key={item.id}
              onClick={() => setCurrentPage(item.id)}
              className={`flex flex-col items-center gap-1 w-12 transition-colors ${
                currentPage === item.id ? 'text-blue-600' : 'text-slate-400 hover:text-slate-600'
              }`}
            >
              <item.icon size={24} className={`transition-transform ${currentPage === item.id ? 'scale-110' : ''}`} />
              <span className="text-[10px] font-medium truncate w-full text-center">{item.label}</span>
            </button>
          ))}
        </nav>
      </div>
    </div>
  );
};

const App: React.FC = () => {
  return (
    <AuthProvider>
      <LanguageProvider>
        <MainLayout />
      </LanguageProvider>
    </AuthProvider>
  );
};

export default App;
