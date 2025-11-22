import React, { useState, useEffect } from 'react';
import { JobTable } from '../components/JobTable';
import { api } from '../services/api';
import { Job } from '../types';
import { Filter, Search, Download, Loader2, RefreshCw } from 'lucide-react';
import { useLanguage } from '../contexts/LanguageContext';

interface JobsPageProps {
  setSidebarCollapsed?: (collapsed: boolean) => void;
}

export const JobsPage: React.FC<JobsPageProps> = ({ setSidebarCollapsed }) => {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const { t } = useLanguage();

  const fetchJobs = async (isBackground = false) => {
    if (!isBackground) setLoading(true);
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
          <h2 className="text-2xl font-bold text-slate-900">{t('jobs.title')}</h2>
          <p className="text-slate-500">{t('jobs.subtitle')}</p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={() => fetchJobs(false)}
            className="flex items-center gap-2 text-slate-600 bg-white border border-slate-300 px-4 py-2 rounded-lg hover:bg-slate-50 text-sm font-medium"
          >
            <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
            {t('jobs.refresh')}
          </button>
          <button className="flex items-center gap-2 text-slate-600 bg-white border border-slate-300 px-4 py-2 rounded-lg hover:bg-slate-50 text-sm font-medium">
            <Download size={16} />
            {t('jobs.export')}
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
        <JobTable jobs={jobs} onRefresh={() => fetchJobs(true)} setSidebarCollapsed={setSidebarCollapsed} />
      )}
    </div>
  );
};