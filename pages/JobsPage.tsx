import React, { useState, useEffect } from 'react';
import { JobTable } from '../components/JobTable';
import { api } from '../services/api';
import { Job } from '../types';
import { Filter, Search, Download, Loader2, RefreshCw } from 'lucide-react';

interface JobsPageProps {
  setSidebarCollapsed?: (collapsed: boolean) => void;
}

export const JobsPage: React.FC<JobsPageProps> = ({ setSidebarCollapsed }) => {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  // const [searchTerm, setSearchTerm] = useState(''); // Moved search to JobTable internal filters

  const fetchJobs = async () => {
    setLoading(true);
    const data = await api.getJobs();
    setJobs(data);
    setLoading(false);
  };

  useEffect(() => {
    fetchJobs();
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">Jobs Market</h2>
          <p className="text-slate-500">Manage and track your opportunities.</p>
        </div>
        <div className="flex gap-3">
          <button 
            onClick={fetchJobs}
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

      {loading ? (
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
           </div>
        </div>
      ) : (
        <JobTable jobs={jobs} onRefresh={fetchJobs} setSidebarCollapsed={setSidebarCollapsed} />
      )}
    </div>
  );
};