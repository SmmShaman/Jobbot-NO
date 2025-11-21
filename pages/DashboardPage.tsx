
import React, { useEffect, useState, useMemo } from 'react';
import { MetricCard } from '../components/MetricCard';
import { Briefcase, Send, Search, Clock, RotateCw, Loader2, Activity, Calendar, DollarSign } from 'lucide-react';
import { api } from '../services/api';
import { Job } from '../types';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';

export const DashboardPage: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [allJobs, setAllJobs] = useState<Job[]>([]); // Store raw data
  
  // Date Range State (Default: Last 7 days)
  const [startDate, setStartDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 6);
    return d.toISOString().split('T')[0];
  });
  const [endDate, setEndDate] = useState(() => new Date().toISOString().split('T')[0]);

  // Calculated Stats
  const [metrics, setMetrics] = useState({
    total: 0,
    newToday: 0,
    applied: 0,
    analyzed: 0,
    totalCost: 0.00
  });

  const [sourceStats, setSourceStats] = useState<any[]>([]);

  const fetchData = async () => {
    setLoading(true);
    const data = await api.getJobs();
    const cost = await api.getTotalCost(); // Separate call for total cost precision
    
    setAllJobs(data);
    calculateGlobalMetrics(data, cost);
    setLoading(false);
  };

  useEffect(() => {
    fetchData();
  }, []);

  const calculateGlobalMetrics = (data: Job[], totalCost: number) => {
    const today = new Date().toISOString().split('T')[0];
    
    // 1. Basic Metrics (Global)
    const total = data.length;
    const newToday = data.filter(j => (j.scannedAt || j.postedDate).startsWith(today)).length;
    const applied = data.filter(j => j.status === 'APPLIED' || j.status === 'SENT').length;
    const analyzed = data.filter(j => j.status === 'ANALYZED').length;

    setMetrics({ total, newToday, applied, analyzed, totalCost });

    // 2. Source Stats (Global)
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

  // Generate Chart Data based on selected Date Range
  const chartData = useMemo(() => {
    const start = new Date(startDate);
    const end = new Date(endDate);
    const days = [];

    // Iterate from start to end date
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        days.push(new Date(d));
    }

    const dateFormatter = new Intl.DateTimeFormat('uk-UA', { day: 'numeric', month: 'long' });

    return days.map(dateObj => {
      const dateStr = dateObj.toISOString().split('T')[0]; // YYYY-MM-DD for comparison
      const dayJobs = allJobs.filter(j => (j.scannedAt || j.postedDate).startsWith(dateStr));
      
      // Format: "21 листопада"
      const label = dateFormatter.format(dateObj);

      return {
        name: label, 
        fullDate: dateStr,
        New: dayJobs.filter(j => !j.status || j.status === 'NEW').length,
        Analyzed: dayJobs.filter(j => j.status === 'ANALYZED').length,
        SoknadReady: dayJobs.filter(j => j.application_id && j.status !== 'APPLIED' && j.status !== 'SENT').length,
        Applied: dayJobs.filter(j => j.status === 'APPLIED' || j.status === 'SENT').length,
      };
    });
  }, [allJobs, startDate, endDate]);

  const getSourceColor = (source: string) => {
    switch(source.toUpperCase()) {
      case 'FINN': return 'bg-blue-500';
      case 'LINKEDIN': return 'bg-blue-800';
      case 'NAV': return 'bg-red-500';
      default: return 'bg-slate-400';
    }
  };

  return (
    <div className="space-y-4 p-2 md:p-4 max-w-[1600px] mx-auto animate-fade-in text-slate-800">
      
      {/* Header Section: Compact */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 pb-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900 tracking-tight">Dashboard</h2>
          <p className="text-xs text-slate-500">System Overview & Analytics</p>
        </div>
        <div className="flex items-center gap-3">
          <button 
            onClick={fetchData}
            className="flex items-center gap-2 bg-white border border-slate-300 text-slate-700 px-3 py-1.5 rounded-lg hover:bg-slate-50 transition-colors text-xs font-medium shadow-sm"
          >
            {loading ? <Loader2 size={14} className="animate-spin" /> : <RotateCw size={14} />}
            Sync
          </button>
        </div>
      </div>

      {/* Metrics Row: Dense */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <MetricCard 
          title="Total Jobs" 
          value={loading ? "-" : metrics.total} 
          icon={<Briefcase />} 
          color="bg-blue-500" 
        />
        <MetricCard 
          title="Analyzed" 
          value={loading ? "-" : metrics.analyzed}
          icon={<Search />} 
          color="bg-purple-500" 
        />
        <MetricCard 
          title="Applications" 
          value={loading ? "-" : metrics.applied}
          icon={<Send />} 
          color="bg-green-500" 
        />
        <MetricCard 
          title="New Today" 
          value={loading ? "-" : metrics.newToday}
          icon={<Clock />} 
          color="bg-slate-500" 
        />
        <MetricCard 
          title="AI Cost (Est.)" 
          value={loading ? "-" : `$${metrics.totalCost.toFixed(2)}`}
          icon={<DollarSign />} 
          color="bg-emerald-500" 
        />
      </div>

      {/* Main Content Grid: 3/4 Chart, 1/4 Sources */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        
        {/* Chart Section */}
        <div className="lg:col-span-3 bg-white p-4 rounded-lg border border-slate-200 shadow-sm h-[400px] flex flex-col">
          
          {/* Chart Header with Date Pickers */}
          <div className="flex flex-col md:flex-row md:items-center justify-between mb-6 gap-4">
            <h3 className="text-sm font-bold text-slate-800">Статистика активності</h3>
            
            <div className="flex items-center gap-2 bg-slate-50 p-1 rounded-lg border border-slate-200">
                <div className="flex items-center gap-2 px-2">
                    <Calendar size={14} className="text-slate-400"/>
                </div>
                <input 
                    type="date" 
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="bg-transparent text-xs font-medium text-slate-600 focus:outline-none border-r border-slate-200 pr-2"
                />
                <span className="text-slate-400 text-xs">–</span>
                <input 
                    type="date" 
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    className="bg-transparent text-xs font-medium text-slate-600 focus:outline-none pl-2"
                />
            </div>

            <div className="flex gap-3 text-[10px] font-medium text-slate-500 hidden sm:flex">
               <span className="flex items-center gap-1"><span className="w-2 h-2 bg-slate-300 rounded-full"></span> New</span>
               <span className="flex items-center gap-1"><span className="w-2 h-2 bg-purple-500 rounded-full"></span> Analyzed</span>
               <span className="flex items-center gap-1"><span className="w-2 h-2 bg-orange-400 rounded-full"></span> Ready</span>
               <span className="flex items-center gap-1"><span className="w-2 h-2 bg-green-500 rounded-full"></span> Applied</span>
            </div>
          </div>

          <div className="flex-1 w-full min-h-0">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }} barSize={24}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis 
                    dataKey="name" 
                    axisLine={false} 
                    tickLine={false} 
                    tick={{fill: '#64748b', fontSize: 11}} 
                    dy={10} 
                    interval={0}
                />
                <YAxis axisLine={false} tickLine={false} tick={{fill: '#94a3b8', fontSize: 10}} />
                <Tooltip 
                  cursor={{fill: '#f8fafc'}}
                  contentStyle={{borderRadius: '6px', border: 'none', boxShadow: '0 2px 5px rgba(0,0,0,0.1)', fontSize: '12px'}}
                />
                <Bar dataKey="New" stackId="a" fill="#cbd5e1" name="Нові" />
                <Bar dataKey="Analyzed" stackId="a" fill="#a855f7" name="Проаналізовані" />
                <Bar dataKey="SoknadReady" stackId="a" fill="#fb923c" name="Готові до відправки" />
                <Bar dataKey="Applied" stackId="a" fill="#22c55e" radius={[3, 3, 0, 0]} name="Відправлені" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Sources Section */}
        <div className="lg:col-span-1 bg-white p-4 rounded-lg border border-slate-200 shadow-sm h-[400px] overflow-y-auto custom-scrollbar">
          <h3 className="text-sm font-bold text-slate-800 mb-4 flex items-center gap-2">
             <Activity size={16} className="text-slate-400" /> Sources
          </h3>
          
          <div className="space-y-4">
             {sourceStats.length === 0 && <p className="text-xs text-slate-400 italic">No data yet.</p>}
             {sourceStats.map((source) => (
               <div key={source.name} className="group">
                  <div className="flex justify-between items-end mb-1">
                    <span className="text-xs font-semibold text-slate-700">{source.name}</span>
                    <span className="text-[10px] text-slate-400 font-mono">{source.count} jobs</span>
                  </div>
                  <div className="w-full bg-slate-100 rounded-full h-1.5 overflow-hidden">
                    <div 
                        className={`h-full rounded-full ${getSourceColor(source.name)} transition-all duration-500`} 
                        style={{ width: `${source.percent}%` }}
                    ></div>
                  </div>
               </div>
             ))}
          </div>

          {/* Mini Footer Info */}
          <div className="mt-auto pt-6 border-t border-slate-100 mt-6">
             <div className="flex items-center justify-between text-[10px] text-slate-400">
                <span>Last updated</span>
                <span>{new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
             </div>
          </div>
        </div>

      </div>
    </div>
  );
};
