
import React, { useState, useEffect, useCallback } from 'react';
import { JobTable } from '../components/JobTable';
import { api } from '../services/api';
import { Job } from '../types';
import { Download, Loader2, RefreshCw } from 'lucide-react';

interface JobsPageProps {
  setSidebarCollapsed?: (collapsed: boolean) => void;
}

export const JobsPage: React.FC<JobsPageProps> = ({ setSidebarCollapsed }) => {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);

  // isBackgroundUpdate param ensures we don't show the full-screen loader on auto-refresh
  const fetchJobs = useCallback(async (isBackgroundUpdate = false) => {
    try {
        if (!isBackgroundUpdate) setLoading(true);
        console.log("JobsPage: Fetching jobs from API...");
        
        const data = await api.getJobs();
        console.log("JobsPage: Received jobs:", data.length);
        
        // Critical Fix: Only update state if data is a valid array. 
        // We do NOT clear the state on error to prevent flickering or disappearance.
        if (Array.isArray(data)) {
             setJobs(data);
        } else {
             console.error("JobsPage: Invalid data format received", data);
        }
    } catch (err) {
        console.error("JobsPage: Fetch error", err);
    } finally {
        if (!isBackgroundUpdate) setLoading(false);
    }
  }, []);

  // Initial load + Realtime Subscription
  useEffect(() => {
    fetchJobs();

    // Subscribe to DB changes (Telegram Bot, etc.)
    const unsubscribe = api.subscribeToChanges(() => {
        console.log("JobsPage: Realtime update detected. Refreshing list...");
        fetchJobs(true); // background update
    });

    return () => {
        unsubscribe();
    };
  }, [fetchJobs]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            Jobs Market
            <span className="flex h-2 w-2 relative">
               <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
               <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500"></span>
            </span>
          </h2>
          <p className="text-slate-500">Manage and track your opportunities.</p>
        </div>
        <div className="flex gap-3">
          <button 
            onClick={() => fetchJobs(false)}
            className="flex items-center gap-2 text-slate-600 bg-white border border-slate-300 px-4 py-2 rounded-lg hover:bg-slate-50 text-sm font-medium"
          >
            <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
            Refresh
          </button>
          <button className="flex items-center gap-2 text-slate-600 bg-white border border-slate-300 px-4 py-2 rounded-lg hover:bg-slate-50 text-sm font-medium">
            <Download size={16} />
            Export CSV
          </button>
        </div>
      </div>

      {loading && jobs.length === 0 ? (
        <div className="flex justify-center items-center h-64 bg-white rounded-xl border border-slate-200">
          <div className="flex flex-col items-center gap-2">
            <Loader2 size={32} className="animate-spin text-blue-600" />
            <p className="text-slate-500">Loading jobs from database...</p>
          </div>
        </div>
      ) : jobs.length === 0 ? (
        <div className="flex justify-center items-center h-64 bg-white rounded-xl border border-slate-200">
           <div className="text-center">
             <p className="text-slate-800 font-medium">No jobs found yet.</p>
             <p className="text-slate-500 text-sm mt-1">Start a scan to find opportunities.</p>
             <button onClick={() => fetchJobs(false)} className="mt-4 text-blue-600 hover:underline text-sm">Try refreshing again</button>
           </div>
        </div>
      ) : (
        <JobTable jobs={jobs} onRefresh={() => fetchJobs(true)} setSidebarCollapsed={setSidebarCollapsed} />
      )}
    </div>
  );
};
