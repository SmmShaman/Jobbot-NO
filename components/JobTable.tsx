
import React, { useState, useMemo, useRef, useEffect } from 'react';
import { Job, Application } from '../types';
import { ExternalLink, MapPin, Building, ChevronDown, ChevronUp, FileText, Bot, Loader2, CheckSquare, Square, Sparkles, Download, AlertCircle, PenTool, Calendar, RefreshCw, X, CheckCircle, Rocket, Eye, ListChecks, DollarSign, Smartphone, RotateCw, Search, Shield, Flame, Zap } from 'lucide-react';
import { api } from '../services/api';
import { useLanguage } from '../contexts/LanguageContext';
import { Radar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, ResponsiveContainer } from 'recharts';

interface JobTableProps {
  jobs: Job[];
  onRefresh?: () => void;
  setSidebarCollapsed?: (collapsed: boolean) => void;
}

export const JobTable: React.FC<JobTableProps> = ({ jobs, onRefresh, setSidebarCollapsed }) => {
  const { t } = useLanguage();
  const [expandedJobId, setExpandedJobId] = useState<string | null>(null);
  const [loadingDesc, setLoadingDesc] = useState<string | null>(null);
  const [descriptions, setDescriptions] = useState<Record<string, string>>({});
  
  // Application State
  const [applicationData, setApplicationData] = useState<Application | null>(null);
  const [isGeneratingApp, setIsGeneratingApp] = useState(false);
  const [isApproving, setIsApproving] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isFillingFinnForm, setIsFillingFinnForm] = useState(false);
  const [isRefreshingStatus, setIsRefreshingStatus] = useState(false);
  const [reanalyzingRadarId, setReanalyzingRadarId] = useState<string | null>(null);
  
  // Accordion State
  const [openSections, setOpenSections] = useState<{ai: boolean, tasks: boolean, desc: boolean, app: boolean}>({
      ai: true,
      tasks: true,
      desc: false,
      app: false 
  });

  // Bulk Selection State
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isProcessingBulk, setIsProcessingBulk] = useState(false);

  // Filter State
  const [showDateDropdown, setShowDateDropdown] = useState(false);
  const dateDropdownRef = useRef<HTMLDivElement>(null);

  const [filters, setFilters] = useState({
    title: '',
    company: '',
    location: '',
    startDate: '',
    endDate: '',
    minScore: 0,
    soknadFilter: 'all' as 'all' | 'with' | 'without',
    formTypeFilter: 'all' as 'all' | 'finn_easy' | 'external_form' | 'external_registration' | 'unknown' | 'no_url',
    deadlineFilter: 'all' as 'all' | 'expired' | 'active' | 'no_deadline'
  });

  // Helper: Check if job deadline is expired
  const isDeadlineExpired = (job: Job): boolean => {
    if (!job.deadline) return false;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const deadline = new Date(job.deadline);
    return deadline < today;
  };

  // Helper: Format deadline for display
  const formatDeadline = (deadline?: string): string => {
    if (!deadline) return '—';
    const date = new Date(deadline);
    return date.toLocaleDateString('nb-NO', { day: 'numeric', month: 'short' });
  };

  // --- UNIVERSAL POLLING EFFECT (Only for expanded job application status) ---
  useEffect(() => {
    let interval: any;
    
    if (expandedJobId) {
        // Reduced frequency to avoid overload, kept specific to open job
        interval = setInterval(async () => {
            await refreshApplicationStatus();
        }, 5000);
    }
    
    return () => clearInterval(interval);
  }, [expandedJobId]);

  const refreshApplicationStatus = async () => {
      if (!expandedJobId) return;
      setIsRefreshingStatus(true);
      const updatedApp = await api.getApplication(expandedJobId);
      if (updatedApp) {
          setApplicationData(prev => {
              // Only trigger update if status actually changed
              if (JSON.stringify(prev) !== JSON.stringify(updatedApp)) {
                  if (onRefresh) onRefresh();
                  return updatedApp;
              }
              return prev;
          });
      }
      setIsRefreshingStatus(false);
  };


  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dateDropdownRef.current && !dateDropdownRef.current.contains(event.target as Node)) {
        setShowDateDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // DEFENSIVE FILTERING
  const filteredJobs = useMemo(() => {
    if (!Array.isArray(jobs)) return [];
    
    return jobs.filter(job => {
      if (!job) return false; // Safety check
      
      // Defensive coding: Ensure safe strings before toLowerCase to prevent crashes
      const safeTitle = String(job.title || '');
      const safeCompany = String(job.company || '');
      const safeLocation = String(job.location || '');

      const matchTitle = safeTitle.toLowerCase().includes((filters.title || '').toLowerCase());
      const matchCompany = safeCompany.toLowerCase().includes((filters.company || '').toLowerCase());
      const matchLocation = safeLocation.toLowerCase().includes((filters.location || '').toLowerCase());
      
      let matchDate = true;
      if (filters.startDate || filters.endDate) {
         // Safe date parsing
         const dateStr = job.scannedAt || job.postedDate;
         if (!dateStr) return false;
         
         const jobDate = new Date(dateStr);
         if (isNaN(jobDate.getTime())) return false;

         if (filters.startDate) {
            const start = new Date(filters.startDate);
            start.setHours(0, 0, 0, 0);
            matchDate = matchDate && jobDate >= start;
         }
         if (filters.endDate) {
            const end = new Date(filters.endDate);
            end.setHours(23, 59, 59, 999);
            matchDate = matchDate && jobDate <= end;
         }
      }

      // Score Filter (slider - minimum score)
      let matchScore = true;
      if (filters.minScore > 0) {
        const score = job.matchScore || 0;
        matchScore = score >= filters.minScore;
      }

      // Søknad Filter
      let matchSoknad = true;
      if (filters.soknadFilter !== 'all') {
        const hasSoknad = !!job.application_id;
        if (filters.soknadFilter === 'with') matchSoknad = hasSoknad;
        else if (filters.soknadFilter === 'without') matchSoknad = !hasSoknad;
      }

      // Form Type Filter (Application method)
      let matchFormType = true;
      if (filters.formTypeFilter !== 'all') {
        if (filters.formTypeFilter === 'no_url') {
          matchFormType = !job.external_apply_url;
        } else {
          const formType = job.application_form_type || 'unknown';
          matchFormType = formType === filters.formTypeFilter;
        }
      }

      // Deadline Filter
      let matchDeadline = true;
      if (filters.deadlineFilter !== 'all') {
        const expired = isDeadlineExpired(job);
        const hasDeadline = !!job.deadline;

        if (filters.deadlineFilter === 'expired') {
          matchDeadline = expired;
        } else if (filters.deadlineFilter === 'active') {
          matchDeadline = hasDeadline && !expired;
        } else if (filters.deadlineFilter === 'no_deadline') {
          matchDeadline = !hasDeadline;
        }
      }

      return matchTitle && matchCompany && matchLocation && matchDate && matchScore && matchSoknad && matchFormType && matchDeadline;
    });
  }, [jobs, filters]);

  const clearDateFilter = () => {
    setFilters(prev => ({ ...prev, startDate: '', endDate: '' }));
    setShowDateDropdown(false);
  };

  const hasValidAnalysis = (job: Job) => {
    if (!job.ai_recommendation) return false;
    if (job.ai_recommendation.length < 20) return false; 
    return true;
  };

  const jobsToExtract = useMemo(() => {
    return filteredJobs.filter(job => 
      selectedIds.has(job.id) && 
      (!job.description || job.description.length < 50) && 
      !descriptions[job.id]
    );
  }, [selectedIds, filteredJobs, descriptions]);

  const jobsToAnalyze = useMemo(() => {
    return filteredJobs.filter(job =>
      selectedIds.has(job.id) &&
      (job.description && job.description.length >= 50 || descriptions[job.id]) &&
      (!hasValidAnalysis(job) || (job.ai_recommendation && job.ai_recommendation.includes('PENDING')))
    );
  }, [selectedIds, filteredJobs, descriptions]);

  // Jobs to check for Enkel søknad (all selected jobs)
  const jobsToCheckEnkel = useMemo(() => {
    return filteredJobs.filter(job => selectedIds.has(job.id));
  }, [selectedIds, filteredJobs]);

  // Jobs needing Skyvern URL extraction (no external_apply_url)
  const jobsNeedingUrlExtraction = useMemo(() => {
    return jobs.filter(job => !job.external_apply_url && job.url);
  }, [jobs]);

  // --- AURA STYLE LOGIC ---
  const getAuraStyle = (job: Job) => {
      if (!job.aura) return '';
      
      const status = job.aura.status;
      // Apply a subtle inset shadow glow based on status
      if (status === 'Toxic') return 'shadow-[inset_0_0_20px_rgba(239,68,68,0.15)] border-l-red-500';
      if (status === 'Growth') return 'shadow-[inset_0_0_20px_rgba(34,197,94,0.15)] border-l-green-500';
      if (status === 'Chill') return 'shadow-[inset_0_0_20px_rgba(59,130,246,0.15)] border-l-blue-500';
      if (status === 'Grind') return 'shadow-[inset_0_0_20px_rgba(168,85,247,0.15)] border-l-purple-500';
      
      return '';
  };

  const getRowStyles = (job: Job, isSelected: boolean) => {
    const base = "transition-all border-l-4 relative overflow-hidden";
    let colors = "";
    const s = (job.status || '').toUpperCase();

    // PRIORITY 1: Check for expired deadline - RED background
    const expired = isDeadlineExpired(job);
    if (expired) {
      if (isSelected) {
        return `${base} bg-red-100 border-l-red-600`;
      }
      return `${base} bg-red-50 border-l-red-500 hover:bg-red-100`;
    }

    // Priority to Aura Glow if analyzed
    const auraGlow = getAuraStyle(job);

    if (s.includes('ANALYZED')) {
        colors = auraGlow ? `bg-white ${auraGlow} hover:brightness-95` : "bg-purple-50/60 border-l-purple-500 hover:bg-purple-100";
    } else if (s.includes('APPLIED') || s.includes('SENT') || s.includes('MANUAL_REVIEW')) {
        colors = "bg-green-50/60 border-l-green-500 hover:bg-green-100";
    } else if (s.includes('REJECTED') || s.includes('FAILED')) {
        colors = "bg-red-50/60 border-l-red-500 hover:bg-red-100";
    } else {
        colors = "bg-white border-l-blue-400 hover:bg-slate-50";
    }

    if (isSelected) {
      return `${base} bg-blue-50 border-l-blue-600`;
    }
    return `${base} ${colors}`;
  };

  const toggleExpand = async (job: Job) => {
    if (expandedJobId === job.id) {
      setExpandedJobId(null);
      setApplicationData(null);
      if (setSidebarCollapsed) setSidebarCollapsed(false);
      return;
    }
    
    if (setSidebarCollapsed) setSidebarCollapsed(true);
    
    setExpandedJobId(job.id);
    setApplicationData(null);
    
    const app = await api.getApplication(job.id);
    if (app) {
        setApplicationData(app);
        setOpenSections({ ai: true, tasks: true, desc: false, app: true });
    } else {
        setOpenSections({ ai: true, tasks: true, desc: false, app: false });
    }

    if (!descriptions[job.id] && !job.description) {
      setLoadingDesc(job.id);
      const result = await api.extractJobText(job.id, job.url);
      if (result.success && result.text) {
        setDescriptions(prev => ({ ...prev, [job.id]: result.text! }));
      }
      setLoadingDesc(null);
    } else if (job.description) {
       setDescriptions(prev => ({ ...prev, [job.id]: job.description! }));
    }
  };

  const toggleSection = (key: 'ai' | 'tasks' | 'desc' | 'app') => {
      setOpenSections(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const handleWriteSoknad = async (job: Job) => {
     if (!descriptions[job.id] && !job.description) {
         alert("Description missing. Extract details first.");
         return;
     }
     setIsGeneratingApp(true);
     setOpenSections(prev => ({ ...prev, app: true }));
     
     const result = await api.generateApplication(job.id);
     setIsGeneratingApp(false);
     
     if (result.success && result.application) {
         setApplicationData(result.application);
         if (onRefresh) onRefresh(); 
     } else {
         alert("Failed to generate application: " + result.message);
     }
  };

  const handleApproveApp = async () => {
    if (!applicationData) return;
    setIsApproving(true);
    const result = await api.approveApplication(applicationData.id);
    setIsApproving(false);
    if (result.success) {
        setApplicationData({ ...applicationData, status: 'approved' });
        if (onRefresh) onRefresh();
    } else {
        alert("Error approving application: " + result.message);
    }
  };

  const handleSendSkyvern = async () => {
     if (!applicationData) return;
     setIsSending(true);
     const result = await api.sendApplication(applicationData.id);
     setIsSending(false);
     if (result.success) {
         setApplicationData({ ...applicationData, status: 'sending' });
         if (onRefresh) onRefresh();
     } else {
         alert("Failed to send: " + result.message);
     }
  };

  const handleRetrySend = async () => {
      if (!applicationData) return;
      setIsSending(true);
      const result = await api.retrySend(applicationData.id);
      setIsSending(false);
      if (result.success) {
          setApplicationData({ ...applicationData, status: 'approved' });
          if (onRefresh) onRefresh();
      } else {
          alert("Error retrying: " + result.message);
      }
  };

  // Check if job has FINN Easy Apply (enkel søknad)
  const isFinnEasyApply = (job: Job): boolean => {
      if (!job.external_apply_url) return false;
      return job.external_apply_url.includes('finn.no/job/apply');
  };

  // Handle filling FINN Easy Apply form via Skyvern
  const handleFillFinnForm = async (job: Job) => {
      if (!isFinnEasyApply(job)) {
          alert("Автозаповнення доступне лише для FINN Enkel Søknad");
          return;
      }
      if (!applicationData) {
          alert("Спочатку напишіть søknad!");
          return;
      }

      setIsFillingFinnForm(true);
      try {
          const result = await api.fillFinnForm(job.id, applicationData.id);
          if (result.success) {
              alert("✅ Заявка відправлена на заповнення! Очікуйте код 2FA в Telegram.");
              if (onRefresh) onRefresh();
          } else {
              alert("❌ Помилка: " + result.message);
          }
      } catch (e: any) {
          alert("❌ Помилка: " + e.message);
      } finally {
          setIsFillingFinnForm(false);
      }
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === filteredJobs.length && filteredJobs.length > 0) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredJobs.map(j => j.id)));
    }
  };

  const toggleSelectOne = (id: string) => {
    const newSet = new Set(selectedIds);
    if (newSet.has(id)) {
      newSet.delete(id);
    } else {
      newSet.add(id);
    }
    setSelectedIds(newSet);
  };

  const handleBulkExtract = async () => {
    if (jobsToExtract.length === 0) return;
    setIsProcessingBulk(true);
    let count = 0;
    for (const job of jobsToExtract) {
      const result = await api.extractJobText(job.id, job.url);
      if (result.success && result.text) {
         setDescriptions(prev => ({ ...prev, [job.id]: result.text! }));
         count++;
      }
    }
    setIsProcessingBulk(false);
    if (count > 0 && onRefresh) onRefresh();
  };

  const handleBulkAnalyze = async () => {
    if (jobsToAnalyze.length === 0) return;
    setIsProcessingBulk(true);
    const idsToAnalyze = jobsToAnalyze.map(j => j.id);
    const result = await api.analyzeJobs(idsToAnalyze);
    setIsProcessingBulk(false);
    if (result.success) {
      setTimeout(() => {
         if (onRefresh) onRefresh();
      }, 2000);
    } else {
      alert("Analysis failed: " + result.message);
    }
  };

  // Check Enkel søknad for selected jobs (re-fetch pages)
  const handleCheckEnkelSoknad = async () => {
    if (jobsToCheckEnkel.length === 0) return;
    setIsProcessingBulk(true);
    let count = 0;
    for (const job of jobsToCheckEnkel) {
      const result = await api.extractJobText(job.id, job.url);
      if (result.success) {
        count++;
      }
    }
    setIsProcessingBulk(false);
    if (count > 0 && onRefresh) onRefresh();
  };

  // Re-analyze single job to generate Radar data
  const handleReanalyzeForRadar = async (jobId: string) => {
    setReanalyzingRadarId(jobId);
    try {
      const result = await api.analyzeJobs([jobId]);
      if (result.success) {
        setTimeout(() => {
          if (onRefresh) onRefresh();
        }, 1500);
      } else {
        alert("Radar generation failed: " + result.message);
      }
    } catch (e: any) {
      alert("Error: " + e.message);
    } finally {
      setReanalyzingRadarId(null);
    }
  };

  const renderStatusBadge = (app: Application) => {
      const badgeBase = "px-2 py-1 text-xs rounded-full font-bold flex items-center gap-1";
      let badgeContent = null;
      let sourceBadge = null;

      if (app.skyvern_metadata && app.skyvern_metadata.source === 'telegram') {
          sourceBadge = <span className="px-2 py-1 bg-indigo-50 text-indigo-600 text-xs rounded-full flex items-center gap-1 font-medium border border-indigo-100"><Smartphone size={10}/> Telegram</span>;
      }

      if (app.status === 'sending') {
          badgeContent = (
            <div className="flex items-center gap-2">
               <span className={`${badgeBase} bg-yellow-100 text-yellow-800`}>
                 <Loader2 size={12} className="animate-spin"/> Sending...
               </span>
               <button onClick={refreshApplicationStatus} className="text-slate-400 hover:text-blue-600" title="Force Refresh">
                  <RotateCw size={12} className={isRefreshingStatus ? "animate-spin" : ""} />
               </button>
            </div>
          );
      } else if (app.status === 'manual_review') {
          badgeContent = <span className={`${badgeBase} bg-green-100 text-green-800`}><CheckCircle size={12}/> Skyvern Done</span>;
      } else if (app.status === 'sent') {
           badgeContent = <span className={`${badgeBase} bg-blue-100 text-blue-800`}><Rocket size={12}/> {t('jobs.status.sent')}</span>;
      } else if (app.status === 'failed') {
          badgeContent = <span className={`${badgeBase} bg-red-100 text-red-800`}><AlertCircle size={12}/> Failed</span>;
      } else if (app.status === 'approved') {
          badgeContent = <span className={`${badgeBase} bg-green-50 text-green-700`}><CheckCircle size={12}/> Approved</span>;
      }

      return <div className="flex gap-2 items-center">{sourceBadge}{badgeContent}</div>;
  };

  // Component to render expansion details
  const renderExpansionContent = (job: Job) => (
    <div className="flex flex-col border-l-[4px] border-blue-600 bg-white animate-fade-in shadow-inner">
      
      {/* 1. AI Analysis & RADAR */}
      <div className="border-b border-slate-100">
         <div onClick={() => toggleSection('ai')} className="flex items-center justify-between p-3 cursor-pointer hover:bg-slate-50">
            <div className="flex items-center gap-2 text-purple-700 font-bold text-sm"><Bot size={16} /> {t('jobs.sections.aiAnalysis')}</div>
            <div className="flex items-center gap-4">
                {job.cost_usd ? (
                    <span className="text-xs text-slate-400 flex items-center gap-1 bg-slate-100 px-2 py-0.5 rounded-full">
                        <DollarSign size={10} /> Cost: ${job.cost_usd.toFixed(4)}
                    </span>
                ) : null}
                <div className="text-slate-400">{openSections.ai ? <ChevronUp size={16} /> : <ChevronDown size={16} />}</div>
            </div>
         </div>
         
         {openSections.ai && (
            <div className="px-4 pb-4 pt-1 bg-white">
                {/* GRID LAYOUT: RADAR vs TEXT */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {/* LEFT: RADAR CHART */}
                    <div className="md:col-span-1 h-[200px] relative flex items-center justify-center bg-slate-50 rounded-lg border border-slate-100 p-2">
                        {job.radarData ? (
                            <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                                <RadarChart cx="50%" cy="50%" outerRadius="70%" data={job.radarData}>
                                <PolarGrid />
                                <PolarAngleAxis dataKey="subject" tick={{ fontSize: 10 }} />
                                <PolarRadiusAxis angle={30} domain={[0, 100]} tick={false} axisLine={false} />
                                <Radar
                                    name="Fit"
                                    dataKey="A"
                                    stroke="#8884d8"
                                    fill="#8884d8"
                                    fillOpacity={0.6}
                                />
                                </RadarChart>
                            </ResponsiveContainer>
                        ) : (
                            <div className="text-center flex flex-col items-center justify-center gap-3">
                                <div className="text-slate-400 text-xs italic">
                                    Radar data not available for this job.
                                </div>
                                <button
                                    onClick={() => handleReanalyzeForRadar(job.id)}
                                    disabled={reanalyzingRadarId === job.id}
                                    className="bg-gradient-to-r from-purple-500 to-blue-500 text-white px-4 py-2 rounded-lg text-xs font-bold flex items-center gap-2 hover:from-purple-600 hover:to-blue-600 transition-all shadow-md disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    {reanalyzingRadarId === job.id ? (
                                        <>
                                            <Loader2 size={14} className="animate-spin" />
                                            Generating...
                                        </>
                                    ) : (
                                        <>
                                            <Zap size={14} />
                                            Generate Radar
                                        </>
                                    )}
                                </button>
                            </div>
                        )}
                        
                        {/* AURA EXPLANATION OVERLAY */}
                        {job.aura && (
                            <div className="absolute top-2 right-2 text-[10px] bg-white/80 p-1.5 rounded shadow backdrop-blur-sm max-w-[150px]">
                                <b>Aura: {job.aura.status}</b><br/>
                                {job.aura.tags.map(tag => <span key={tag} className="inline-block mr-1 mb-1 px-1 bg-slate-100 rounded">{tag}</span>)}
                            </div>
                        )}
                    </div>

                    {/* RIGHT: TEXT ANALYSIS */}
                    <div className="md:col-span-2 text-sm text-slate-700 max-h-[200px] overflow-y-auto custom-scrollbar p-2">
                        {hasValidAnalysis(job) ? <p className="whitespace-pre-wrap">{job.ai_recommendation}</p> : <span className="text-slate-400 italic">No analysis available.</span>}
                    </div>
                </div>
            </div>
         )}
      </div>

      {/* 2. Tasks Summary */}
      <div className="border-b border-slate-100">
         <div onClick={() => toggleSection('tasks')} className="flex items-center justify-between p-3 cursor-pointer hover:bg-slate-50">
            <div className="flex items-center gap-2 text-blue-700 font-bold text-sm"><ListChecks size={16} /> {t('jobs.sections.duties')}</div>
            <div className="text-slate-400">{openSections.tasks ? <ChevronUp size={16} /> : <ChevronDown size={16} />}</div>
         </div>
         {openSections.tasks && (
            <div className="px-4 pb-4 pt-1 text-sm text-slate-700 bg-white">
                {job.tasks_summary ? (
                    <div className="whitespace-pre-wrap bg-blue-50/50 p-3 rounded-lg border border-blue-100 text-slate-800">{job.tasks_summary}</div>
                ) : (
                    <span className="text-slate-400 italic">Summary not available yet. Run analysis to generate.</span>
                )}
            </div>
         )}
      </div>

      {/* 3. Description */}
      <div className="border-b border-slate-100">
         <div onClick={() => toggleSection('desc')} className="flex items-center justify-between p-3 cursor-pointer hover:bg-slate-50">
            <div className="flex items-center gap-2 text-slate-700 font-bold text-sm"><FileText size={16} /> {t('jobs.sections.description')}</div>
            <div className="text-slate-400">{openSections.desc ? <ChevronUp size={16} /> : <ChevronDown size={16} />}</div>
         </div>
         {openSections.desc && <div className="px-4 pb-4 pt-1 text-sm text-slate-600 bg-white max-h-[300px] overflow-y-auto">{loadingDesc === job.id ? <Loader2 className="animate-spin mx-auto" /> : <div className="whitespace-pre-wrap">{descriptions[job.id] || job.description || "No description."}</div>}</div>}
      </div>

      {/* 4. Application */}
      <div className="">
         <div onClick={() => toggleSection('app')} className="flex items-center justify-between p-3 cursor-pointer hover:bg-green-50/50 bg-green-50/20">
            <div className="flex items-center gap-2 text-green-700 font-bold text-sm"><PenTool size={16} /> {t('jobs.sections.application')}</div>
            
            <div className="flex items-center gap-3" onClick={(e) => e.stopPropagation()}>
                {applicationData ? (
                    <>
                        {renderStatusBadge(applicationData)}
                        {applicationData.skyvern_metadata?.task_id && <a href={`http://localhost:8080/tasks/${applicationData.skyvern_metadata.task_id}`} target="_blank" rel="noreferrer" className="text-blue-600 hover:text-blue-800 text-xs font-medium flex items-center gap-1"><Eye size={14}/> {t('jobs.actions.viewTask')}</a>}
                        {applicationData.status === 'draft' && <button onClick={handleApproveApp} disabled={isApproving} className="text-xs bg-green-600 text-white px-3 py-1.5 rounded hover:bg-green-700 flex items-center gap-1 shadow-sm">{isApproving ? <Loader2 size={12} className="animate-spin"/> : <CheckCircle size={12}/>} {t('jobs.actions.approve')}</button>}
                        {applicationData.status === 'approved' && <button onClick={handleSendSkyvern} disabled={isSending} className="text-xs bg-blue-600 text-white px-3 py-1.5 rounded hover:bg-blue-700 flex items-center gap-1 shadow-sm">{isSending ? <Loader2 size={12} className="animate-spin"/> : <Rocket size={12}/>} {t('jobs.actions.sendSkyvern')}</button>}
                        {(applicationData.status === 'failed' || applicationData.status === 'sent' || applicationData.status === 'manual_review') &&
                            <button onClick={handleRetrySend} disabled={isSending} className="text-xs bg-orange-500 text-white px-3 py-1.5 rounded hover:bg-orange-600 flex items-center gap-1 shadow-sm" title="Reset to Approved">
                                <RefreshCw size={12}/> {t('jobs.actions.retry')}
                            </button>
                        }
                        {/* FINN Easy Apply Button */}
                        {isFinnEasyApply(job) ? (
                            <button
                                onClick={() => handleFillFinnForm(job)}
                                disabled={isFillingFinnForm || applicationData.status === 'sending'}
                                className="text-xs bg-gradient-to-r from-blue-600 to-cyan-600 text-white px-3 py-1.5 rounded hover:from-blue-700 hover:to-cyan-700 flex items-center gap-1 shadow-sm disabled:opacity-50"
                                title="Заповнити форму на FINN.no"
                            >
                                {isFillingFinnForm ? <Loader2 size={12} className="animate-spin"/> : <Zap size={12}/>}
                                FINN Søknad
                            </button>
                        ) : job.external_apply_url ? (
                            <span
                                className="text-xs bg-slate-200 text-slate-500 px-3 py-1.5 rounded flex items-center gap-1 cursor-not-allowed"
                                title={`Автозаповнення недоступне. URL: ${job.external_apply_url}`}
                            >
                                <ExternalLink size={12}/> Вручну
                            </span>
                        ) : null}
                    </>
                ) : (
                    <button onClick={() => handleWriteSoknad(job)} disabled={(!descriptions[job.id] && !job.description)} className={`text-xs px-3 py-1.5 rounded font-medium text-white flex items-center gap-1 shadow-sm ${(!descriptions[job.id] && !job.description) ? 'bg-slate-300' : 'bg-green-600 hover:bg-green-700'}`}><Sparkles size={12} /> {t('jobs.actions.writeSoknad')}</button>
                )}
                <div className="text-slate-400 pl-2 border-l">{openSections.app ? <ChevronUp size={16} /> : <ChevronDown size={16} />}</div>
            </div>
         </div>
         
         {openSections.app && (
            <div className="p-6 border-t border-slate-100 text-sm bg-white">
               {isGeneratingApp ? <div className="text-center py-8 text-slate-500"><Loader2 className="animate-spin mx-auto mb-2" /> Writing...</div> : 
               applicationData ? (
                  <div className="space-y-4">
                      <div className="flex justify-between">
                        <h5 className="font-bold text-xs text-slate-500 mb-1">Norsk</h5>
                        {applicationData.cost_usd && <span className="text-[10px] text-slate-400">Est. Cost: ${applicationData.cost_usd.toFixed(4)}</span>}
                      </div>
                      <div className="p-3 bg-slate-50 rounded border whitespace-pre-wrap">{applicationData.cover_letter_no}</div>
                      {applicationData.cover_letter_uk && <div><h5 className="font-bold text-xs text-slate-500 mb-1">Ukrainian</h5><div className="p-3 bg-slate-50 rounded border whitespace-pre-wrap text-slate-600">{applicationData.cover_letter_uk}</div></div>}
                  </div>
               ) : <div className="text-center py-4 text-slate-400 italic">No application generated yet.</div>}
            </div>
         )}
      </div>

    </div>
  );

  return (
    <div className="space-y-4">
      {/* TOOLBAR */}
      <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-sm flex flex-col md:flex-row flex-wrap md:items-center gap-3">
        <div className="flex-1 flex items-center gap-2 min-w-[200px]">
            <div className="relative flex-1">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
                <input type="text" placeholder={t('jobs.searchPlaceholder')} className="w-full pl-8 pr-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" value={filters.title} onChange={e => setFilters({...filters, title: e.target.value})} />
            </div>
            <div className="relative flex-1 hidden md:block">
                <Building className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
                <input type="text" placeholder={t('jobs.companyPlaceholder')} className="w-full pl-8 pr-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" value={filters.company} onChange={e => setFilters({...filters, company: e.target.value})} />
            </div>
            <div className="relative flex-1 hidden md:block">
                <MapPin className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
                <input type="text" placeholder={t('jobs.locationPlaceholder')} className="w-full pl-8 pr-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" value={filters.location} onChange={e => setFilters({...filters, location: e.target.value})} />
            </div>
            <div className="relative" ref={dateDropdownRef}>
                <button onClick={() => setShowDateDropdown(!showDateDropdown)} className={`flex items-center gap-2 px-3 py-2 text-sm border rounded-lg hover:bg-slate-50 ${filters.startDate || filters.endDate ? 'bg-blue-50 text-blue-700 border-blue-200' : 'border-slate-200 text-slate-600'}`}>
                    <Calendar size={14} /> <span>{filters.startDate ? 'Filtered' : t('jobs.dateFilter')}</span>
                </button>
                {showDateDropdown && (
                    <div className="absolute top-full right-0 mt-1 w-64 bg-white rounded-lg shadow-xl border z-50 p-3">
                        <div className="space-y-3">
                        <div><label className="text-xs text-slate-500 font-medium">From:</label><input type="date" className="w-full px-2 py-1 text-sm border rounded" value={filters.startDate} onChange={e => setFilters({...filters, startDate: e.target.value})} /></div>
                        <div><label className="text-xs text-slate-500 font-medium">To:</label><input type="date" className="w-full px-2 py-1 text-sm border rounded" value={filters.endDate} onChange={e => setFilters({...filters, endDate: e.target.value})} /></div>
                        <div className="flex justify-between pt-2 border-t">
                             <button onClick={() => setShowDateDropdown(false)} className="text-xs text-slate-500">Close</button>
                             <button onClick={clearDateFilter} className="text-xs text-red-500 flex items-center gap-1"><X size={12} /> Clear</button>
                        </div>
                        </div>
                    </div>
                )}
            </div>

            {/* Score Filter - Slider */}
            <div className={`flex items-center gap-2 px-3 py-1.5 border rounded-lg ${filters.minScore > 0 ? 'bg-purple-50 border-purple-200' : 'border-slate-200'}`}>
              <span className="text-xs text-slate-500 whitespace-nowrap">Score ≥</span>
              <input
                type="range"
                min="0"
                max="100"
                step="5"
                value={filters.minScore}
                onChange={e => setFilters({...filters, minScore: Number(e.target.value)})}
                className="w-24 h-1.5 accent-purple-600 cursor-pointer"
              />
              <span className={`text-xs font-bold min-w-[28px] ${filters.minScore >= 80 ? 'text-green-600' : filters.minScore >= 50 ? 'text-purple-600' : 'text-slate-500'}`}>
                {filters.minScore}
              </span>
            </div>

            {/* Søknad Filter */}
            <select
              value={filters.soknadFilter}
              onChange={e => setFilters({...filters, soknadFilter: e.target.value as any})}
              className={`px-3 py-2 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${filters.soknadFilter !== 'all' ? 'bg-green-50 text-green-700 border-green-200' : 'border-slate-200 text-slate-600'}`}
            >
              <option value="all">Søknad: All</option>
              <option value="with">✓ Written</option>
              <option value="without">✗ Not written</option>
            </select>

            {/* Form Type Filter (Application method) */}
            <select
              value={filters.formTypeFilter}
              onChange={e => setFilters({...filters, formTypeFilter: e.target.value as any})}
              className={`px-3 py-2 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${filters.formTypeFilter !== 'all' ? 'bg-blue-50 text-blue-700 border-blue-200' : 'border-slate-200 text-slate-600'}`}
            >
              <option value="all">Подача: All</option>
              <option value="no_url">🔴 Без URL ({jobsNeedingUrlExtraction.length})</option>
              <option value="finn_easy">⚡ FINN Easy</option>
              <option value="external_form">📝 Форма</option>
              <option value="external_registration">🔐 Реєстрація</option>
              <option value="unknown">❓ Невідомо</option>
            </select>

            {/* Deadline Filter */}
            <select
              value={filters.deadlineFilter}
              onChange={e => setFilters({...filters, deadlineFilter: e.target.value as any})}
              className={`px-3 py-2 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${filters.deadlineFilter !== 'all' ? (filters.deadlineFilter === 'expired' ? 'bg-red-50 text-red-700 border-red-200' : 'bg-green-50 text-green-700 border-green-200') : 'border-slate-200 text-slate-600'}`}
            >
              <option value="all">Дедлайн: All</option>
              <option value="expired">🔴 Протерміновані</option>
              <option value="active">🟢 Активні</option>
              <option value="no_deadline">⚪ Без дедлайну</option>
            </select>
        </div>

        <div className="flex items-center gap-2 pl-0 md:pl-3 md:border-l border-slate-200 justify-between md:justify-start w-full md:w-auto">
          {selectedIds.size > 0 ? (
            <>
              <button 
                onClick={handleBulkExtract}
                disabled={isProcessingBulk || jobsToExtract.length === 0}
                title="Extract description"
                className={`flex items-center gap-1 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                   jobsToExtract.length > 0 ? 'bg-blue-600 text-white hover:bg-blue-700' : 'bg-slate-100 text-slate-400 cursor-not-allowed'}`}
              >
                 {isProcessingBulk ? <Loader2 className="animate-spin" size={14} /> : <Download size={14} />}
                 <span className="inline">{t('jobs.extract')}</span> {jobsToExtract.length > 0 && <span className="bg-white/20 px-1.5 rounded text-xs">{jobsToExtract.length}</span>}
              </button>

              <button
                onClick={handleBulkAnalyze}
                disabled={isProcessingBulk || jobsToAnalyze.length === 0}
                title="Analyze Relevance"
                className={`flex items-center gap-1 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                   jobsToAnalyze.length > 0 ? 'bg-purple-600 text-white hover:bg-purple-700' : 'bg-slate-100 text-slate-400 cursor-not-allowed'}`}
              >
                 {isProcessingBulk ? <Loader2 className="animate-spin" size={14} /> : <Sparkles size={14} />}
                 <span className="inline">{t('jobs.analyze')}</span> {jobsToAnalyze.length > 0 && <span className="bg-white/20 px-1.5 rounded text-xs">{jobsToAnalyze.length}</span>}
              </button>

              <button
                onClick={handleCheckEnkelSoknad}
                disabled={isProcessingBulk || jobsToCheckEnkel.length === 0}
                title="Check application form type"
                className={`flex items-center gap-1 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                   jobsToCheckEnkel.length > 0 ? 'bg-cyan-600 text-white hover:bg-cyan-700' : 'bg-slate-100 text-slate-400 cursor-not-allowed'}`}
              >
                 {isProcessingBulk ? <Loader2 className="animate-spin" size={14} /> : <Zap size={14} />}
                 <span className="hidden md:inline">Тип подачі</span> {jobsToCheckEnkel.length > 0 && <span className="bg-white/20 px-1.5 rounded text-xs">{jobsToCheckEnkel.length}</span>}
              </button>
            </>
          ) : (
             <span className="text-xs text-slate-400 italic px-2">{t('jobs.selectAction')}</span>
          )}
        </div>
      </div>

      {/* TABLE VIEW (Desktop) */}
      <div className="hidden md:block bg-white shadow-sm rounded-xl border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto min-h-[400px]">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 border-b border-slate-200 text-xs uppercase text-slate-500 font-semibold tracking-wider">
              <tr>
                <th className="px-4 py-3 w-10">
                  <button onClick={toggleSelectAll} className="text-slate-400 hover:text-blue-600">
                    {selectedIds.size === filteredJobs.length && filteredJobs.length > 0 ? <CheckSquare size={18} /> : <Square size={18} />}
                  </button>
                </th>
                <th className="px-4 py-3 w-10"></th>
                <th className="px-4 py-3">{t('jobs.table.title')}</th>
                <th className="px-4 py-3">{t('jobs.table.company')}</th>
                <th className="px-4 py-3">{t('jobs.table.location')}</th>
                <th className="px-4 py-3">{t('jobs.table.added')}</th>
                <th className="px-4 py-3">Frist</th>
                <th className="px-4 py-3">{t('jobs.table.match')}</th>
                <th className="px-4 py-3 text-center">Søknad</th>
                <th className="px-4 py-3 text-center">Подача</th>
                <th className="px-4 py-3 text-right">{t('jobs.table.link')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredJobs.length === 0 ? (
                  <tr>
                      <td colSpan={11} className="px-4 py-12 text-center text-slate-400 italic">
                          No jobs found matching filters.
                      </td>
                  </tr>
              ) : filteredJobs.map((job) => (
                <React.Fragment key={job.id}>
                  <tr className={`${getRowStyles(job, selectedIds.has(job.id))} group cursor-pointer`} onClick={() => toggleExpand(job)}>
                    <td className="px-4 py-4" onClick={(e) => e.stopPropagation()}>
                        <button onClick={() => toggleSelectOne(job.id)} className="text-slate-400 hover:text-blue-600">
                            {selectedIds.has(job.id) ? <CheckSquare size={18} className="text-blue-600" /> : <Square size={18} />}
                        </button>
                    </td>
                    <td className="px-4 py-4 text-slate-400">
                        {expandedJobId === job.id ? <ChevronUp size={18} /> : <ChevronDown size={18} className="group-hover:text-blue-500" />}
                    </td>
                    <td className="px-4 py-4">
                        <span className="font-medium text-slate-900 block flex items-center gap-2">
                            {job.title}
                            {job.aura && (
                                <span className={`text-[10px] px-1.5 py-0.5 rounded uppercase font-bold border flex items-center gap-1`} style={{ color: job.aura.color, borderColor: job.aura.color, backgroundColor: `${job.aura.color}15` }}>
                                    {job.aura.status === 'Toxic' ? <Flame size={10}/> : job.aura.status === 'Growth' ? <Zap size={10}/> : <Shield size={10}/>}
                                    {job.aura.status}
                                </span>
                            )}
                        </span>
                        <span className="text-[10px] text-slate-400 uppercase tracking-wider">{job.source}</span>
                    </td>
                    <td className="px-4 py-4 text-slate-600">{job.company}</td>
                    <td className="px-4 py-4 text-slate-500">{job.location}</td>
                    <td className="px-4 py-4 text-slate-500 text-xs">{job.postedDate}</td>
                    <td className="px-4 py-4">
                      {job.deadline ? (
                        <span className={`text-xs font-medium px-2 py-1 rounded ${
                          isDeadlineExpired(job)
                            ? 'bg-red-100 text-red-700'
                            : 'bg-green-50 text-green-700'
                        }`}>
                          {formatDeadline(job.deadline)}
                        </span>
                      ) : (
                        <span className="text-slate-300 text-xs">—</span>
                      )}
                    </td>
                    <td className="px-4 py-4">
                      {job.matchScore ? (
                        <div className="flex items-center gap-2">
                          <div className="w-full max-w-[40px] bg-slate-100 rounded-full h-1.5"><div className={`h-1.5 rounded-full ${job.matchScore >= 80 ? 'bg-green-500' : job.matchScore >= 50 ? 'bg-yellow-500' : 'bg-red-500'}`} style={{ width: `${job.matchScore}%` }}></div></div>
                          <span className={`font-bold text-xs ${job.matchScore >= 80 ? 'text-green-600' : job.matchScore >= 50 ? 'text-yellow-600' : 'text-red-600'}`}>{job.matchScore}</span>
                        </div>
                      ) : <span className="text-slate-300 text-xs">-</span>}
                    </td>
                    <td className="px-4 py-4 text-center">
                      {job.application_id ? (
                        <span className="inline-flex items-center justify-center px-2 py-1 rounded-full bg-green-500 text-white text-xs font-bold">
                          ✓
                        </span>
                      ) : (
                        <span className="text-slate-300 text-xs">—</span>
                      )}
                    </td>
                    <td className="px-4 py-4 text-center">
                      {job.external_apply_url ? (
                        <a
                          href={job.external_apply_url}
                          target="_blank"
                          rel="noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="inline-flex items-center justify-center px-2 py-1 rounded-full text-white text-xs font-bold cursor-pointer hover:ring-2 hover:ring-offset-1 transition-all"
                          style={{
                            backgroundColor: job.application_form_type === 'finn_easy' ? '#3b82f6' :
                                           job.application_form_type === 'external_form' ? '#22c55e' :
                                           job.application_form_type === 'external_registration' ? '#f97316' :
                                           job.application_form_type === 'email' ? '#8b5cf6' : '#94a3b8'
                          }}
                          title={`Відкрити: ${job.external_apply_url.substring(0, 50)}...`}
                        >
                          {job.application_form_type === 'finn_easy' ? '⚡' :
                           job.application_form_type === 'external_form' ? '📝' :
                           job.application_form_type === 'external_registration' ? '🔐' :
                           job.application_form_type === 'email' ? '📧' : '🔗'}
                        </a>
                      ) : job.application_form_type === 'finn_easy' ? (
                        <span className="inline-flex items-center justify-center px-2 py-1 rounded-full bg-blue-500 text-white text-xs font-bold" title="FINN Enkel søknad">
                          ⚡
                        </span>
                      ) : job.application_form_type === 'external_form' ? (
                        <span className="inline-flex items-center justify-center px-2 py-1 rounded-full bg-green-500 text-white text-xs font-bold" title="External form (no registration)">
                          📝
                        </span>
                      ) : job.application_form_type === 'external_registration' ? (
                        <span className="inline-flex items-center justify-center px-2 py-1 rounded-full bg-orange-500 text-white text-xs font-bold" title="Registration required">
                          🔐
                        </span>
                      ) : job.application_form_type === 'processing' ? (
                        <span className="inline-flex items-center justify-center px-2 py-1 rounded-full bg-yellow-400 text-yellow-900 text-xs font-bold animate-pulse" title="Skyvern обробляє...">
                          ⏳
                        </span>
                      ) : (
                        <span className="inline-flex items-center justify-center px-2 py-1 rounded-full bg-slate-300 text-slate-600 text-xs font-bold" title="Натисніть 'Тип подачі' щоб витягти URL">
                          ?
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-4 text-right">
                        <a href={job.url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="inline-block text-slate-400 hover:text-blue-600 p-1"><ExternalLink size={16} /></a>
                    </td>
                  </tr>

                  {expandedJobId === job.id && (
                    <tr className="bg-slate-50 border-b border-slate-200">
                      <td colSpan={11} className="p-0">
                         {renderExpansionContent(job)}
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* CARD VIEW (Mobile) */}
      <div className="md:hidden space-y-3">
         {filteredJobs.length === 0 ? (
             <div className="text-center py-12 text-slate-400 italic">No jobs match your filters.</div>
         ) : filteredJobs.map((job) => (
            <div key={job.id} className={`bg-white rounded-xl border shadow-sm overflow-hidden ${selectedIds.has(job.id) ? 'border-blue-500 ring-1 ring-blue-500' : 'border-slate-200'}`}>
               <div 
                 className={`p-4 flex gap-3 relative ${expandedJobId === job.id ? 'bg-slate-50' : ''}`}
                 onClick={() => toggleExpand(job)}
               >
                  <div className={`absolute left-0 top-0 bottom-0 w-1.5 ${
                      String(job.status).includes('NEW') ? 'bg-blue-500' :
                      String(job.status).includes('ANALYZED') ? 'bg-purple-500' :
                      String(job.status).includes('APPLIED') || String(job.status).includes('SENT') ? 'bg-green-500' :
                      'bg-slate-300'
                  }`} />

                  <div onClick={(e) => { e.stopPropagation(); toggleSelectOne(job.id); }} className="pt-1">
                      {selectedIds.has(job.id) ? <CheckSquare size={20} className="text-blue-600"/> : <Square size={20} className="text-slate-300"/>}
                  </div>

                  <div className="flex-1 min-w-0">
                      <div className="flex justify-between items-start mb-1">
                          <h3 className="font-bold text-slate-800 truncate pr-2 text-sm">{job.title}</h3>
                          {job.matchScore && (
                             <span className={`text-xs font-bold px-1.5 py-0.5 rounded ${
                                 job.matchScore >= 70 ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'
                             }`}>
                                {job.matchScore}%
                             </span>
                          )}
                      </div>
                      <div className="text-xs text-slate-600 mb-1 flex items-center gap-1">
                          <Building size={12} /> {job.company}
                      </div>
                      <div className="flex items-center justify-between text-[11px] text-slate-400">
                          <div className="flex items-center gap-2">
                             <span className="flex items-center gap-0.5"><MapPin size={10}/> {job.location}</span>
                             <span>•</span>
                             <span>{job.source}</span>
                          </div>
                          <div className="flex items-center gap-2">
                              <span>{job.postedDate}</span>
                              <a href={job.url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="text-slate-400 hover:text-blue-600"><ExternalLink size={14} /></a>
                          </div>
                      </div>
                      
                      {/* Mobile Badges */}
                      <div className="mt-2 flex flex-wrap gap-1">
                          {job.deadline && (
                              <span className={`text-[10px] px-1.5 py-0.5 rounded uppercase font-bold border flex items-center gap-1 w-fit ${
                                isDeadlineExpired(job)
                                  ? 'border-red-300 bg-red-50 text-red-600'
                                  : 'border-green-300 bg-green-50 text-green-600'
                              }`}>
                                  {isDeadlineExpired(job) ? '🔴' : '📅'} {formatDeadline(job.deadline)}
                              </span>
                          )}
                          {job.aura && (
                              <span className={`text-[10px] px-1.5 py-0.5 rounded uppercase font-bold border flex items-center gap-1 w-fit`} style={{ color: job.aura.color, borderColor: job.aura.color, backgroundColor: `${job.aura.color}15` }}>
                                  {job.aura.status === 'Toxic' ? <Flame size={10}/> : job.aura.status === 'Growth' ? <Zap size={10}/> : <Shield size={10}/>}
                                  {job.aura.status}
                              </span>
                          )}
                          {job.application_form_type === 'finn_easy' ? (
                              <span className="text-[10px] px-1.5 py-0.5 rounded uppercase font-bold border border-blue-300 bg-blue-50 text-blue-600 flex items-center gap-1 w-fit">
                                  ⚡ FINN
                              </span>
                          ) : job.application_form_type === 'external_form' ? (
                              <span className="text-[10px] px-1.5 py-0.5 rounded uppercase font-bold border border-green-300 bg-green-50 text-green-600 flex items-center gap-1 w-fit">
                                  📝 Форма
                              </span>
                          ) : job.application_form_type === 'external_registration' ? (
                              <span className="text-[10px] px-1.5 py-0.5 rounded uppercase font-bold border border-orange-300 bg-orange-50 text-orange-600 flex items-center gap-1 w-fit">
                                  🔐 Реєстр.
                              </span>
                          ) : (
                              <span className="text-[10px] px-1.5 py-0.5 rounded uppercase font-bold border border-slate-300 bg-slate-50 text-slate-500 flex items-center gap-1 w-fit">
                                  ? Невідомо
                              </span>
                          )}
                          {job.application_id && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded uppercase font-bold border border-green-300 bg-green-50 text-green-600 flex items-center gap-1 w-fit">
                                  ✓ Søknad
                              </span>
                          )}
                      </div>
                  </div>
               </div>
               
               {expandedJobId === job.id && (
                   <div className="border-t border-slate-200">
                      {renderExpansionContent(job)}
                   </div>
               )}
            </div>
         ))}
      </div>

    </div>
  );
};
