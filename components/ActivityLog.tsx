
import React, { useEffect, useState } from 'react';
import { api } from '../services/api';
import { SystemLog } from '../types';
import { Loader2, RefreshCw, Scroll, Zap, Bot, Terminal, FileText } from 'lucide-react';
import { useLanguage } from '../contexts/LanguageContext';

export const ActivityLog: React.FC = () => {
  const [logs, setLogs] = useState<SystemLog[]>([]);
  const [loading, setLoading] = useState(true);
  const { t, language } = useLanguage();

  const fetchLogs = async () => {
    setLoading(true);
    const data = await api.getSystemLogs();
    setLogs(data);
    setLoading(false);
  };

  useEffect(() => {
    fetchLogs();
  }, []);

  const formatSource = (source: string) => {
    switch (source) {
      case 'TELEGRAM': return 'Telegram Bot';
      case 'WEB_DASHBOARD': return 'Dashboard';
      case 'CRON': return 'Cron';
      case 'GITHUB_ACTIONS': return 'GitHub Actions';
      default: return source;
    }
  };

  const formatLogMessage = (log: SystemLog) => {
    const locale = language === 'uk' ? 'uk-UA' : language === 'no' ? 'nb-NO' : 'en-US';
    const date = new Date(log.created_at).toLocaleString(locale, {
      day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit'
    });
    
    const status = log.status === 'SUCCESS' ? t('activity.success') : t('activity.error');
    const cost = log.cost_usd ? log.cost_usd.toFixed(4) : '0';
    const tokens = log.tokens_used || 0;

    if (log.event_type === 'SCAN' && log.details) {
      const { jobsFound = 0, newJobs = 0, analyzed = 0, duplicates = 0 } = log.details;
      
      return (
        <div className="text-sm text-slate-700 leading-relaxed">
          <span className="font-bold text-slate-900">{t('activity.scanned')} {date}</span>, <span className={log.status === 'SUCCESS' ? 'text-green-600 font-medium' : 'text-red-600 font-medium'}>{status}</span>.<br/>
          {t('activity.scannedCount')} <span className="font-bold">{jobsFound}</span>, <span className="font-bold">{duplicates}</span> {t('activity.duplicates')}, <span className="font-bold text-green-600">{newJobs}</span> {t('activity.added')}, <span className="font-bold text-purple-600">{analyzed}</span> {t('activity.analyzed')}.<br/>
          {t('activity.source')}: <span className="font-medium">{formatSource(log.source)}</span>.<br/>
          <span className="text-slate-500 text-xs bg-slate-100 px-2 py-0.5 rounded-full mt-1 inline-block">
             {tokens.toLocaleString()} tokens (~${cost})
          </span>
        </div>
      );
    }

    if (log.event_type === 'PROFILE_GEN') {
       return (
         <div className="text-sm text-slate-700 leading-relaxed">
            <span className="font-bold text-slate-900">Profile Generation {date}</span>, <span className={log.status === 'SUCCESS' ? 'text-green-600 font-medium' : 'text-red-600 font-medium'}>{status}</span>.<br/>
            {log.message}<br/>
            <span className="text-slate-500 text-xs bg-slate-100 px-2 py-0.5 rounded-full mt-1 inline-block">
                {tokens.toLocaleString()} tokens (~${cost})
            </span>
         </div>
       );
    }

    if (log.event_type === 'APPLICATION_GEN') {
       return (
         <div className="text-sm text-slate-700 leading-relaxed">
            <span className="font-bold text-slate-900">Cover Letter {date}</span>, <span className={log.status === 'SUCCESS' ? 'text-green-600 font-medium' : 'text-red-600 font-medium'}>{status}</span>.<br/>
            {log.message}<br/>
            <span className="text-slate-500 text-xs bg-slate-100 px-2 py-0.5 rounded-full mt-1 inline-block">
                {tokens.toLocaleString()} tokens (~${cost})
            </span>
         </div>
       );
    }

    if (log.event_type === 'ANALYSIS') {
       const jobsAnalyzed = log.details?.jobs_analyzed || 0;
       return (
         <div className="text-sm text-slate-700 leading-relaxed">
            <span className="font-bold text-slate-900">Job Analysis {date}</span>, <span className={log.status === 'SUCCESS' ? 'text-green-600 font-medium' : 'text-red-600 font-medium'}>{status}</span>.<br/>
            {log.message}{jobsAnalyzed > 0 && <> ({jobsAnalyzed} jobs)</>}<br/>
            <span className="text-slate-500 text-xs bg-slate-100 px-2 py-0.5 rounded-full mt-1 inline-block">
                {tokens.toLocaleString()} tokens (~${cost})
            </span>
         </div>
       );
    }

    // Fallback for other types
    return (
        <div className="text-sm text-slate-700 leading-relaxed">
            <span className="font-bold text-slate-900">{date}</span> - {log.event_type}<br/>
            {log.message}
        </div>
    );
  };

  const getIcon = (type: string) => {
     if (type === 'SCAN') return <Zap size={18} className="text-blue-500"/>;
     if (type === 'PROFILE_GEN') return <Bot size={18} className="text-purple-500"/>;
     if (type === 'APPLICATION_GEN') return <FileText size={18} className="text-green-500"/>;
     if (type === 'ANALYSIS') return <Zap size={18} className="text-amber-500"/>;
     return <Terminal size={18} className="text-slate-500"/>;
  };

  return (
    <div className="max-w-4xl mx-auto p-4">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 flex items-center gap-2"><Scroll className="text-blue-600"/> {t('activity.title')}</h2>
          <p className="text-slate-500 text-sm">{t('activity.subtitle')}</p>
        </div>
        <button 
          onClick={fetchLogs} 
          className="bg-white border border-slate-300 p-2 rounded-lg hover:bg-slate-50 text-slate-600 transition-colors"
        >
          <RefreshCw size={20} className={loading ? "animate-spin" : ""} />
        </button>
      </div>

      <div className="space-y-4">
        {loading ? (
          <div className="flex justify-center py-12"><Loader2 className="animate-spin text-blue-500" size={32} /></div>
        ) : logs.length === 0 ? (
           <div className="text-center py-12 text-slate-400 italic">{t('activity.empty')}</div>
        ) : (
          logs.map((log) => (
            <div key={log.id} className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex gap-4 items-start transition-all hover:shadow-md">
               <div className="bg-slate-50 p-3 rounded-full border border-slate-100 shrink-0">
                  {getIcon(log.event_type)}
               </div>
               <div className="flex-1">
                  {formatLogMessage(log)}
               </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
