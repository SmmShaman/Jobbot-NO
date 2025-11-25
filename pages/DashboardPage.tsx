
import React, { useEffect, useState, useMemo } from 'react';
import { MetricCard } from '../components/MetricCard';
import { Briefcase, Send, Search, Clock, Activity, DollarSign, EyeOff, Filter, Trash2, CheckSquare } from 'lucide-react';
import { api } from '../services/api';
import { Job } from '../types';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { JobMap } from '../components/JobMap';
import { useLanguage } from '../contexts/LanguageContext';

export const DashboardPage: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [allJobs, setAllJobs] = useState<Job[]>([]);
  const { t, language } = useLanguage();
  
  const [startDate, setStartDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 6);
    return d.toISOString().split('T')[0];
  });
  const [endDate, setEndDate] = useState(() => new Date().toISOString().split('T')[0]);

  const [metrics, setMetrics] = useState({
    total: 0,
    newToday: 0,
    applied: 0,
    analyzed: 0,
    totalCost: 0.00
  });
  
  // Detailed Cost States
  const [lastActionCost, setLastActionCost] = useState(0);
  const [dailyCost, setDailyCost] = useState(0);
  const [calcJobCount, setCalcJobCount] = useState(5);

  const [sourceStats, setSourceStats] = useState<any[]>([]);

  // Map Filter States
  const [mapAgeFilter, setMapAgeFilter] = useState<'all' | '7d' | '10d' | '30d'>('all');
  const [mapHideApplied, setMapHideApplied] = useState(false);
  const [mapCleared, setMapCleared] = useState(false);

  const fetchData = async (isBackgroundUpdate = false) => {
    if (!isBackgroundUpdate) setLoading(true);
    try {
        const data = await api.getJobs();
        const cost = await api.getTotalCost();
        
        // Ensure data is valid before setting state to avoid crashes
        if (Array.isArray(data)) {
            setAllJobs(data);
            calculateGlobalMetrics(data, cost);
        }
    } catch (error) {
        console.error("Dashboard fetch error:", error);
    } finally {
        if (!isBackgroundUpdate) setLoading(false);
    }
  };

  // Run ONCE on mount + Setup Realtime Subscription
  useEffect(() => {
    // Initial fetch
    fetchData();

    // Set up Realtime listener
    // When DB changes, we re-fetch data silently (no loading spinner)
    const unsubscribe = api.subscribeToChanges(() => {
        console.log("Dashboard: Realtime update detected. Refreshing data...");
        fetchData(true);
    });

    return () => {
        unsubscribe();
    };
  }, []);

  const calculateGlobalMetrics = (data: Job[], totalCost: number) => {
    const today = new Date().toISOString().split('T')[0];
    const total = data.length;
    const newToday = data.filter(j => (j.scannedAt || j.postedDate).startsWith(today)).length;
    const applied = data.filter(j => j.status === 'APPLIED' || j.status === 'SENT').length;
    const analyzed = data.filter(j => j.status === 'ANALYZED').length;

    // --- Detailed Cost Logic ---
    // 1. Last Action Cost (Find most recently analyzed job)
    const sortedByDate = [...data].sort((a, b) => new Date(b.scannedAt).getTime() - new Date(a.scannedAt).getTime());
    const lastJob = sortedByDate.find(j => j.cost_usd && j.cost_usd > 0);
    setLastActionCost(lastJob ? (lastJob.cost_usd || 0) : 0);

    // 2. Daily Cost
    const dailySum = data.filter(j => (j.scannedAt || j.postedDate).startsWith(today)).reduce((acc, curr) => acc + (curr.cost_usd || 0), 0);
    setDailyCost(dailySum);

    setMetrics({ total, newToday, applied, analyzed, totalCost });

    const sources = data.reduce((acc, job) => {
      const s = job.source || 'Other';
      acc[s] = (acc[s] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const sourceArray = Object.entries(sources).map(([name, count]) => ({
      name,
      count,
      percent: total > 0 ? Math.round((count / total) * 100) : 0
    })).sort((a, b) => b.count - a.count);

    setSourceStats(sourceArray);
  };

  // --- Manual Calculator Logic ---
  const calculatedCost = useMemo(() => {
      if (allJobs.length === 0) return 0;
      const analyzedJobs = allJobs.filter(j => j.status === 'ANALYZED' && j.cost_usd);
      const slice = analyzedJobs.slice(0, calcJobCount);
      return slice.reduce((acc, j) => acc + (j.cost_usd || 0), 0);
  }, [allJobs, calcJobCount]);

  // --- Map Filtering Logic ---
  const filteredMapJobs = useMemo(() => {
      if (mapCleared) return [];
      
      return allJobs.filter(job => {
          const date = new Date(job.scannedAt || job.postedDate);
          const now = new Date();
          const diffTime = Math.abs(now.getTime() - date.getTime());
          const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

          // Age Filter
          if (mapAgeFilter === '7d' && diffDays > 7) return false;
          if (mapAgeFilter === '10d' && diffDays > 10) return false;
          if (mapAgeFilter === '30d' && diffDays > 30) return false;

          // Status Filter
          if (mapHideApplied && (job.status === 'APPLIED' || job.status === 'SENT')) return false;

          return true;
      });
  }, [allJobs, mapAgeFilter, mapHideApplied, mapCleared]);

  const chartData = useMemo(() => {
    const start = new Date(startDate);
    const end = new Date(endDate);
    const days = [];

    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        days.push(new Date(d));
    }

    // Localize date
    const locale = language === 'uk' ? 'uk-UA' : language === 'no' ? 'nb-NO' : 'en-US';
    const dateFormatter = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long' });

    return days.map(dateObj => {
      const dateStr = dateObj.toISOString().split('T')[0];
      const dayJobs = allJobs.filter(j => (j.scannedAt || j.postedDate).startsWith(dateStr));
      
      return {
        name: dateFormatter.format(dateObj), 
        fullDate: dateStr,
        New: dayJobs.filter(j => !j.status || j.status === 'NEW').length,
        Analyzed: dayJobs.filter(j => j.status === 'ANALYZED').length,
        SoknadReady: dayJobs.filter(j => j.application_id && j.status !== 'APPLIED' && j.status !== 'SENT').length,
        Applied: dayJobs.filter(j => j.status === 'APPLIED' || j.status === 'SENT').length,
      };
    });
  }, [allJobs, startDate, endDate, language]);

  const getSourceColor = (source: string) => {
    switch(source.toUpperCase()) {
      case 'FINN': return 'bg-blue-500';
      case 'LINKEDIN': return 'bg-blue-800';
      case 'NAV': return 'bg-red-500';
      default: return 'bg-slate-400';
    }
  };

  return (
    <div className="space-y-4 md:space-y-3 p-2 md:p-0 max-w-[1600px] mx-auto animate-fade-in text-slate-800 md:h-[calc(100vh-4rem)] md:flex md:flex-col md:overflow-hidden">
      
      {/* SECTION 1: TOP CHARTS (Fixed height, don't shrink on desktop) */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 shrink-0">
        {/* Title & Controls Block */}
        <div className="bg-slate-900 text-white p-4 rounded-xl shadow-sm flex flex-col justify-between lg:col-span-1">
            <div>
              <h2 className="text-xl font-bold tracking-tight mb-1">{t('dashboard.title')}</h2>
              <div className="flex items-center gap-2">
                 <p className="text-slate-400 text-xs">{t('dashboard.subtitle')}</p>
                 <span className="flex h-2 w-2 relative">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
                 </span>
              </div>
            </div>
            
            <div className="mt-4 text-[10px] text-slate-500">
               Realtime Updates Active.
            </div>
        </div>

        {/* Activity Chart */}
        <div className="lg:col-span-2 bg-white p-3 rounded-xl border border-slate-200 shadow-sm h-[180px] flex flex-col">
             <div className="flex justify-between items-center mb-1">
                <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider">{t('dashboard.activityStats')}</h3>
                <div className="flex items-center gap-2 bg-slate-50 p-0.5 rounded border border-slate-100">
                    <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="bg-transparent text-[10px] font-medium text-slate-500 focus:outline-none w-20" />
                    <span className="text-slate-300 text-[10px]">-</span>
                    <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="bg-transparent text-[10px] font-medium text-slate-500 focus:outline-none w-20" />
                </div>
             </div>
             <div className="flex-1 w-full min-h-0">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} margin={{ top: 5, right: 5, left: -25, bottom: 0 }} barSize={12}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                    <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{fill: '#64748b', fontSize: 9}} interval={0} />
                    <YAxis axisLine={false} tickLine={false} tick={{fill: '#94a3b8', fontSize: 9}} />
                    <Tooltip cursor={{fill: '#f8fafc'}} contentStyle={{borderRadius: '6px', fontSize: '11px', padding: '4px'}} />
                    <Bar dataKey="New" stackId="a" fill="#3b82f6" name={t('jobs.status.new')} />
                    <Bar dataKey="Analyzed" stackId="a" fill="#a855f7" name={t('jobs.status.analyzed')} />
                    <Bar dataKey="SoknadReady" stackId="a" fill="#f97316" name={t('jobs.status.draft')} />
                    <Bar dataKey="Applied" stackId="a" fill="#22c55e" name={t('jobs.status.sent')} />
                  </BarChart>
                </ResponsiveContainer>
             </div>
        </div>

        {/* NEW LOCATION: Cost Analysis Panel (Expanded) */}
        <div className="lg:col-span-1 bg-white p-4 rounded-xl border border-slate-200 shadow-sm h-[180px] flex flex-col justify-between relative overflow-hidden">
            <div className="flex justify-between items-start border-b border-slate-100 pb-2">
               <h3 className="font-bold text-slate-700 text-sm">{t('dashboard.costPanel.title')}</h3>
               <div className="p-1.5 bg-emerald-50 rounded text-emerald-600"><DollarSign size={16} /></div>
            </div>
            
            <div className="flex-1 flex flex-col justify-center gap-3 py-1">
                <div className="flex justify-between items-end">
                    <span className="text-xs text-slate-500">{t('dashboard.costPanel.lastAction')}</span>
                    <span className="font-mono font-bold text-slate-800 text-sm">${lastActionCost.toFixed(4)}</span>
                </div>
                <div className="flex justify-between items-end">
                    <span className="text-xs text-slate-500">{t('dashboard.costPanel.daily')}</span>
                    <span className="font-mono font-bold text-emerald-600 text-sm">${dailyCost.toFixed(2)}</span>
                </div>
            </div>

            <div className="bg-slate-50 p-2 rounded border border-slate-100 flex items-center justify-between mt-auto">
               <div className="flex flex-col">
                  <span className="text-[10px] text-slate-500 leading-tight flex items-center gap-1">
                    {t('dashboard.costPanel.calcDesc')} 
                    <input type="number" min="1" value={calcJobCount} onChange={e => setCalcJobCount(Number(e.target.value))} className="w-8 bg-white border border-slate-200 rounded text-center focus:outline-none font-bold text-blue-600 p-0.5" /> 
                    {t('dashboard.costPanel.jobs')}
                  </span>
               </div>
               <span className="font-mono font-bold text-blue-600 text-xs">${calculatedCost.toFixed(3)}</span>
            </div>
            
            <div className="absolute top-3 right-12 text-[10px] text-slate-400 font-medium bg-slate-50 px-2 py-0.5 rounded-full border border-slate-100">
                Total: ${metrics.totalCost.toFixed(2)}
            </div>
        </div>
      </div>

      {/* SECTION 2: METRICS (Don't shrink) */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 shrink-0">
        <MetricCard title={t('dashboard.totalJobs')} value={loading ? "-" : metrics.total} icon={<Briefcase />} color="bg-blue-500" />
        <MetricCard title={t('dashboard.analyzed')} value={loading ? "-" : metrics.analyzed} icon={<Search />} color="bg-purple-500" />
        <MetricCard title={t('dashboard.applications')} value={loading ? "-" : metrics.applied} icon={<Send />} color="bg-green-500" />
        <MetricCard title={t('dashboard.newToday')} value={loading ? "-" : metrics.newToday} icon={<Clock />} color="bg-slate-500" />
        
        {/* NEW LOCATION: Sources (Compact) */}
        <div className="bg-white p-3 rounded-lg border border-slate-200 shadow-sm flex flex-col h-full">
            <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2 flex items-center gap-1"><Activity size={10} /> {t('dashboard.sources')}</h3>
            <div className="flex-1 overflow-y-auto custom-scrollbar space-y-2 pr-1">
                {sourceStats.map((source) => (
                <div key={source.name} className="group">
                    <div className="flex justify-between items-end mb-0.5">
                        <span className="text-[10px] font-semibold text-slate-600 truncate max-w-[60px]">{source.name}</span>
                        <span className="text-[9px] text-slate-400 font-mono">{source.count}</span>
                    </div>
                    <div className="w-full bg-slate-100 rounded-full h-1 overflow-hidden">
                        <div className={`h-full rounded-full ${getSourceColor(source.name)}`} style={{ width: `${source.percent}%` }}></div>
                    </div>
                </div>
                ))}
            </div>
        </div>
      </div>

      {/* SECTION 3: MAP (Responsive Height + Flex Fill on Desktop) */}
      <div className="w-full h-[350px] md:h-auto md:flex-1 bg-white rounded-xl border border-slate-200 shadow-sm p-1 relative z-0 min-h-[200px]">
          
          {/* Map Title Badge */}
          <div className="absolute top-3 left-3 z-[1000] bg-white/90 px-3 py-1.5 rounded shadow-sm text-sm font-bold text-slate-700 border border-slate-200 backdrop-blur-sm flex items-center gap-2">
             <MetricCardIcon size={14} className="text-blue-600"/> {t('dashboard.mapTitle')} <span className="bg-slate-100 px-1.5 rounded text-xs text-slate-500">{filteredMapJobs.length}</span>
          </div>

          {/* NEW: Map Controls Overlay */}
          <div className="absolute top-3 right-3 z-[1000] bg-white/95 rounded-lg shadow-lg border border-slate-200 backdrop-blur-md flex flex-col text-xs overflow-hidden">
             <div className="bg-slate-50 px-3 py-1.5 border-b border-slate-200 font-bold text-slate-600 flex items-center gap-2">
                <Filter size={12} /> {t('dashboard.map.filters')}
             </div>
             <div className="p-2 space-y-2">
                {/* Age Filter */}
                <div className="flex bg-slate-100 p-0.5 rounded">
                   {(['all', '7d', '10d', '30d'] as const).map(opt => (
                      <button 
                        key={opt} 
                        onClick={() => { setMapAgeFilter(opt); setMapCleared(false); }}
                        className={`flex-1 px-2 py-1 rounded text-[10px] font-medium transition-all ${
                            mapAgeFilter === opt && !mapCleared ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                        }`}
                      >
                         {opt === 'all' ? t('dashboard.map.showAll') : opt === '7d' ? '7d' : opt === '10d' ? '10d' : '30d'}
                      </button>
                   ))}
                </div>
                
                {/* Toggles */}
                <div className="flex flex-col gap-1">
                   <button 
                      onClick={() => { setMapHideApplied(!mapHideApplied); setMapCleared(false); }}
                      className={`flex items-center gap-2 px-2 py-1.5 rounded transition-colors ${mapHideApplied && !mapCleared ? 'bg-blue-50 text-blue-700' : 'hover:bg-slate-50 text-slate-600'}`}
                   >
                      {mapHideApplied ? <EyeOff size={12} /> : <CheckSquare size={12} />} {t('dashboard.map.hideApplied')}
                   </button>
                   <button 
                      onClick={() => setMapCleared(!mapCleared)}
                      className={`flex items-center gap-2 px-2 py-1.5 rounded transition-colors ${mapCleared ? 'bg-red-50 text-red-600' : 'hover:bg-slate-50 text-slate-600'}`}
                   >
                      <Trash2 size={12} /> {t('dashboard.map.clear')}
                   </button>
                </div>
             </div>
          </div>

          <JobMap jobs={filteredMapJobs} />
      </div>

    </div>
  );
};

const MetricCardIcon = ({className, size}: {className?: string, size: number}) => (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}><polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"></polygon><line x1="8" y1="2" x2="8" y2="18"></line><line x1="16" y1="6" x2="16" y2="22"></line></svg>
);
