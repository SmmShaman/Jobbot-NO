import React, { useState } from 'react';
import { Sidebar } from './components/Sidebar';
import { DashboardPage } from './pages/DashboardPage';
import { JobsPage } from './pages/JobsPage';
import { SettingsPage } from './pages/SettingsPage';
import { Menu, X } from 'lucide-react';

const App: React.FC = () => {
  const [currentPage, setCurrentPage] = useState('dashboard');
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  
  // Sidebar State
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);

  const renderPage = () => {
    switch (currentPage) {
      case 'dashboard':
        return <DashboardPage />;
      case 'jobs':
        return <JobsPage setSidebarCollapsed={setIsSidebarCollapsed} />;
      case 'settings':
        return <SettingsPage />;
      case 'activity':
        return (
          <div className="bg-white p-8 rounded-xl border border-slate-200">
            <h2 className="text-xl font-bold text-slate-800 mb-4">Worker Activity Log</h2>
            <div className="space-y-4">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="flex items-start gap-4 p-4 bg-slate-50 rounded-lg border border-slate-100">
                  <div className="w-2 h-2 rounded-full bg-green-500 mt-2"></div>
                  <div>
                    <p className="font-medium text-slate-800">Successfully scanned 15 jobs from FINN.no</p>
                    <p className="text-sm text-slate-500">2 hours ago • Worker ID: worker-norway-01</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      default:
        return <DashboardPage />;
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans">
      <Sidebar 
        currentPage={currentPage} 
        onNavigate={(page) => {
          setCurrentPage(page);
          setIsMobileMenuOpen(false);
        }} 
        isCollapsed={isSidebarCollapsed}
        onToggleCollapse={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
      />
      
      {/* Mobile Header */}
      <div className="md:hidden bg-slate-900 text-white p-4 flex justify-between items-center sticky top-0 z-40">
        <span className="font-bold text-lg">JobBot NO</span>
        <button onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}>
          {isMobileMenuOpen ? <X size={24} /> : <Menu size={24} />}
        </button>
      </div>

      {/* Mobile Menu Overlay */}
      {isMobileMenuOpen && (
        <div className="md:hidden fixed inset-0 z-30 bg-slate-900 pt-20 px-4">
          <nav className="flex flex-col gap-2">
            {['dashboard', 'jobs', 'activity', 'settings'].map(page => (
              <button 
                key={page}
                onClick={() => {
                  setCurrentPage(page);
                  setIsMobileMenuOpen(false);
                }}
                className="text-white text-left py-3 px-4 rounded-lg hover:bg-slate-800 capitalize"
              >
                {page}
              </button>
            ))}
          </nav>
        </div>
      )}

      <main 
        className={`transition-all duration-300 ease-in-out p-4 md:p-8 max-w-[1920px] mx-auto ${
          isSidebarCollapsed ? 'md:ml-20' : 'md:ml-64'
        }`}
      >
        {renderPage()}
      </main>
    </div>
  );
};

export default App;