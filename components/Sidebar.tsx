
import React from 'react';
import { LayoutDashboard, Briefcase, Settings, Activity, Bot, ChevronLeft, ChevronRight, User, LogOut, Shield } from 'lucide-react';
import { useLanguage } from '../contexts/LanguageContext';
import { useAuth } from '../contexts/AuthContext';

interface SidebarProps {
  currentPage: string;
  onNavigate: (page: string) => void;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ currentPage, onNavigate, isCollapsed, onToggleCollapse }) => {
  const { t, language, setLanguage } = useLanguage();
  const { signOut, role } = useAuth();

  const navItems = [
    { id: 'dashboard', label: t('nav.dashboard'), icon: LayoutDashboard },
    { id: 'jobs', label: t('nav.jobs'), icon: Briefcase },
    { id: 'activity', label: t('nav.activity'), icon: Activity },
    { id: 'settings', label: t('nav.settings'), icon: Settings },
  ];

  return (
    <aside 
      className={`hidden md:flex flex-col bg-slate-900 text-white min-h-screen fixed left-0 top-0 z-50 transition-all duration-300 ease-in-out ${
        isCollapsed ? 'w-20' : 'w-64'
      }`}
    >
      {/* Header */}
      <div className={`p-6 flex items-center gap-3 border-b border-slate-800 h-[88px] ${isCollapsed ? 'justify-center' : ''}`}>
        <div className="p-2 bg-blue-600 rounded-lg shrink-0">
          <Bot size={24} className="text-white" />
        </div>
        {!isCollapsed && (
          <div className="overflow-hidden whitespace-nowrap">
            <h1 className="font-bold text-lg tracking-tight">JobBot NO</h1>
            <p className="text-xs text-slate-400">Automation Admin</p>
          </div>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 py-6 px-3 space-y-2">
        {navItems.map((item) => (
          <button
            key={item.id}
            onClick={() => onNavigate(item.id)}
            className={`w-full flex items-center gap-3 px-3 py-3 rounded-lg transition-colors text-sm font-medium group relative ${
              currentPage === item.id
                ? 'bg-blue-600 text-white shadow-md'
                : 'text-slate-400 hover:bg-slate-800 hover:text-white'
            } ${isCollapsed ? 'justify-center' : ''}`}
            title={isCollapsed ? item.label : ''}
          >
            <item.icon size={20} className="shrink-0" />
            {!isCollapsed && <span>{item.label}</span>}
            
            {/* Tooltip for collapsed mode */}
            {isCollapsed && (
              <div className="absolute left-full ml-2 px-2 py-1 bg-slate-800 text-white text-xs rounded opacity-0 group-hover:opacity-100 pointer-events-none whitespace-nowrap z-50">
                {item.label}
              </div>
            )}
          </button>
        ))}

        {/* Admin Only Link */}
        {role === 'admin' && (
          <button
            onClick={() => onNavigate('admin')}
            className={`w-full flex items-center gap-3 px-3 py-3 rounded-lg transition-colors text-sm font-medium group relative ${
              currentPage === 'admin'
                ? 'bg-red-600 text-white shadow-md'
                : 'text-red-400 hover:bg-slate-800 hover:text-white'
            } ${isCollapsed ? 'justify-center' : ''}`}
            title={isCollapsed ? t('nav.admin') : ''}
          >
            <Shield size={20} className="shrink-0" />
            {!isCollapsed && <span>{t('nav.admin')}</span>}
          </button>
        )}

        <div className="border-t border-slate-800 my-2"></div>

        {/* User Account Link */}
        <button
          onClick={() => onNavigate('profile')}
          className={`w-full flex items-center gap-3 px-3 py-3 rounded-lg transition-colors text-sm font-medium group relative ${
            currentPage === 'profile'
              ? 'bg-blue-600 text-white shadow-md'
              : 'text-slate-400 hover:bg-slate-800 hover:text-white'
          } ${isCollapsed ? 'justify-center' : ''}`}
          title={isCollapsed ? t('nav.account') : ''}
        >
          <User size={20} className="shrink-0" />
          {!isCollapsed && <span>{t('nav.account')}</span>}
        </button>
      </nav>

      {/* Language Switcher */}
      <div className={`px-4 py-2 flex gap-2 justify-center ${isCollapsed ? 'flex-col' : 'flex-row'}`}>
         <button onClick={() => setLanguage('uk')} className={`text-lg hover:scale-110 transition-transform ${language === 'uk' ? 'opacity-100 grayscale-0' : 'opacity-50 grayscale'}`} title="Українська">🇺🇦</button>
         <button onClick={() => setLanguage('no')} className={`text-lg hover:scale-110 transition-transform ${language === 'no' ? 'opacity-100 grayscale-0' : 'opacity-50 grayscale'}`} title="Norsk">🇳🇴</button>
         <button onClick={() => setLanguage('en')} className={`text-lg hover:scale-110 transition-transform ${language === 'en' ? 'opacity-100 grayscale-0' : 'opacity-50 grayscale'}`} title="English">🇬🇧</button>
      </div>

      {/* Footer / Collapse Toggle */}
      <div className="p-4 border-t border-slate-800 flex flex-col gap-4">
        {!isCollapsed && (
          <button 
            onClick={signOut}
            className="flex items-center gap-2 text-xs text-red-400 hover:text-red-300 transition-colors"
          >
            <LogOut size={14} /> {t('nav.logout')}
          </button>
        )}
        
        <button 
          onClick={onToggleCollapse}
          className="w-full flex items-center justify-center p-2 rounded-lg text-slate-500 hover:bg-slate-800 hover:text-white transition-colors"
        >
          {isCollapsed ? <ChevronRight size={20} /> : <div className="flex items-center gap-2 text-xs font-medium"><ChevronLeft size={16}/> {t('nav.collapse')}</div>}
        </button>
      </div>
    </aside>
  );
};
