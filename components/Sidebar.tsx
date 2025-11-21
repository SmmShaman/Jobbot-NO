import React from 'react';
import { LayoutDashboard, Briefcase, Settings, Activity, Bot, ChevronLeft, ChevronRight } from 'lucide-react';

interface SidebarProps {
  currentPage: string;
  onNavigate: (page: string) => void;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ currentPage, onNavigate, isCollapsed, onToggleCollapse }) => {
  const navItems = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'jobs', label: 'Jobs', icon: Briefcase },
    { id: 'activity', label: 'Worker Activity', icon: Activity },
    { id: 'settings', label: 'Settings', icon: Settings },
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
      </nav>

      {/* Footer / Collapse Toggle */}
      <div className="p-4 border-t border-slate-800 flex flex-col gap-4">
        {!isCollapsed && (
          <div className="bg-slate-800 rounded-lg p-4 whitespace-nowrap overflow-hidden">
            <p className="text-xs text-slate-400 mb-2">Worker Status</p>
            <div className="flex items-center gap-2">
              <span className="relative flex h-3 w-3">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-3 w-3 bg-green-500"></span>
              </span>
              <span className="text-sm font-semibold text-green-400">Online</span>
            </div>
          </div>
        )}
        
        <button 
          onClick={onToggleCollapse}
          className="w-full flex items-center justify-center p-2 rounded-lg text-slate-500 hover:bg-slate-800 hover:text-white transition-colors"
        >
          {isCollapsed ? <ChevronRight size={20} /> : <div className="flex items-center gap-2 text-xs font-medium"><ChevronLeft size={16}/> Collapse Sidebar</div>}
        </button>
      </div>
    </aside>
  );
};