
import React, { useState, useEffect } from 'react';
import { 
  User, FileText, Globe, Briefcase, Lock, Save, Upload, 
  Trash2, Play, CheckCircle, AlertCircle, Loader2, Edit2, Plus, Database, Key, ExternalLink, Bot, PenTool, Clock, Zap, BookOpen, Terminal, Eye, X
} from 'lucide-react';
import { api } from '../services/api';
import { CVProfile, KnowledgeBaseItem } from '../types';
import { useLanguage } from '../contexts/LanguageContext';
import { Language } from '../services/translations';

interface SettingsPageProps {
  initialTab?: string;
}

// --- DEFAULT PROMPTS (The actual logic used by Edge Functions) ---

const DEFAULT_PROFILE_GEN_PROMPT = `You are an expert Candidate Profile Analyst. 
Your goal is to extract structured information from the provided resume text to create a "Master Profile" used for job matching and application writing.

INSTRUCTIONS:
1. Analyze the provided resume text(s).
2. Consolidate into a single coherent profile description in English.
3. Highlight:
   - Core Skills (Tech stack, Soft skills)
   - Years of Experience
   - Key Achievements (Metrics driven)
   - Education & Certifications
   - Preferred Roles
4. The tone should be professional and factual.
5. Do NOT summarize it like a bio; structure it so an AI can easily compare it against job descriptions later.`;

const DEFAULT_JOB_ANALYSIS_PROMPT = `You are a Job Relevance Analyzer.
TASK:
1. Analyze how well the candidate fits this job based on the provided Profile and Job Description.
2. Provide a Relevance Score (0-100).
3. Provide a concise explanation highlighting Pros and Cons.
4. EXTRACT TASKS: List specifically what the candidate needs to DO (Daily duties).

OUTPUT FORMAT (JSON ONLY):
{
  "score": number,
  "analysis": "string (markdown supported, keep it under 200 words)",
  "tasks": "string (bullet point list of 3-5 key tasks)"
}`;

const DEFAULT_APP_PROMPT = `You are an expert career consultant for the Norwegian job market.
Your task is to write a "Søknad" (Cover Letter) based on the provided Job Description and Candidate Profile.

GUIDELINES:
1. Language: Norwegian (Bokmål).
2. Tone: Professional, enthusiastic, but humble (Norwegian work culture).
3. Structure:
   - Header (Standard formal letter format).
   - Introduction: Mention specific position and company.
   - Body Paragraph 1: Why this company? (Connect to their values/mission).
   - Body Paragraph 2: Why me? (Connect my skills to their requirements).
   - Body Paragraph 3: Personal touch / Motivation.
   - Conclusion: Request for interview.
4. Length: ~300-400 words.
5. Do not invent facts. Use the Candidate Profile.`;

export const SettingsPage: React.FC<SettingsPageProps> = ({ initialTab = 'resume' }) => {
  const { t } = useLanguage();
  const [activeTab, setActiveTab] = useState(initialTab);
  
  // State Variables
  const [files, setFiles] = useState<File[]>([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<string>('');
  const [profiles, setProfiles] = useState<CVProfile[]>([]);
  const [isLoadingProfiles, setIsLoadingProfiles] = useState(false);
  const [dbStatus, setDbStatus] = useState<{ success: boolean; message: string } | null>(null);
  
  const [viewingProfile, setViewingProfile] = useState<CVProfile | null>(null);

  const [searchUrls, setSearchUrls] = useState<string[]>([]);
  const [newUrl, setNewUrl] = useState('');
  const [isSavingUrls, setIsSavingUrls] = useState(false);
  const [isLoadingUrls, setIsLoadingUrls] = useState(false);

  const [appPrompt, setAppPrompt] = useState(DEFAULT_APP_PROMPT);
  const [genPrompt, setGenPrompt] = useState(DEFAULT_PROFILE_GEN_PROMPT);
  const [analyzePrompt, setAnalyzePrompt] = useState(DEFAULT_JOB_ANALYSIS_PROMPT);
  const [isSavingPrompts, setIsSavingPrompts] = useState(false);
  const [activePromptTab, setActivePromptTab] = useState<'gen' | 'analyze' | 'app'>('gen');

  // AI Analysis Language
  const [analysisLang, setAnalysisLang] = useState<Language>('uk');

  const [autoEnabled, setAutoEnabled] = useState(false);
  const [scanTime, setScanTime] = useState('15:00');
  const [isSavingAuto, setIsSavingAuto] = useState(false);
  const [isScanning, setIsScanning] = useState(false); 
  const [scanLogs, setScanLogs] = useState<string[]>([]);

  const [kbItems, setKbItems] = useState<KnowledgeBaseItem[]>([]);
  const [isLoadingKb, setIsLoadingKb] = useState(false);
  const [newKbQ, setNewKbQ] = useState('');
  const [newKbA, setNewKbA] = useState('');
  const [newKbCat, setNewKbCat] = useState('general');

  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);

  useEffect(() => {
    if (activeTab === 'resume') {
      checkDb();
      loadProfiles();
      loadPrompts(); 
    }
    if (activeTab === 'search') loadSearchUrls();
    if (activeTab === 'ai_config') {
        loadPrompts();
        loadAnalysisLanguage();
    }
    if (activeTab === 'automation') loadAutomation();
    if (activeTab === 'knowledge') loadKnowledgeBase();
  }, [activeTab]);

  const checkDb = async () => { const status = await api.cv.verifyDatabaseConnection(); setDbStatus(status); };
  const loadProfiles = async () => { setIsLoadingProfiles(true); const data = await api.cv.getProfiles(); setProfiles(data); setIsLoadingProfiles(false); };
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => { if (e.target.files) setFiles(Array.from(e.target.files)); };
  
  const handleUploadAndAnalyze = async () => { 
      if (files.length === 0) return;
      setIsAnalyzing(true);
      setAnalysisResult("Uploading and analyzing... this takes about 30 seconds.");
      const paths = [];
      for (const file of files) {
          const path = await api.cv.uploadResume(file);
          if (path) paths.push(path);
      }
      if (paths.length > 0) {
          const systemPrompt = genPrompt || DEFAULT_PROFILE_GEN_PROMPT;
          const result = await api.cv.analyzeResumes(paths, systemPrompt, "Please create a profile from these files.");
          setAnalysisResult(result);
      } else {
          setAnalysisResult("Failed to upload files.");
      }
      setIsAnalyzing(false);
  };

  const handleSaveProfile = async () => { 
      const name = `Profile ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()}`;
      const fileNames = files.map(f => f.name);
      await api.cv.saveProfile(name, analysisResult, files.length, fileNames);
      loadProfiles();
      setAnalysisResult('');
      setFiles([]);
  };
  
  const handleSetActive = async (id: string) => { await api.cv.setProfileActive(id); loadProfiles(); };
  const handleDelete = async (id: string) => { await api.cv.deleteProfile(id); loadProfiles(); };
  const loadSearchUrls = async () => { setIsLoadingUrls(true); setSearchUrls(await api.settings.getSearchUrls()); setIsLoadingUrls(false); };
  const addUrl = () => { if (newUrl) setSearchUrls([...searchUrls, newUrl]); setNewUrl(''); };
  const removeUrl = (i: number) => { const u = [...searchUrls]; u.splice(i, 1); setSearchUrls(u); };
  const saveUrls = async () => { setIsSavingUrls(true); await api.settings.saveSearchUrls(searchUrls); setIsSavingUrls(false); };

  const loadPrompts = async () => { 
      const p = await api.settings.getAllPrompts(); 
      // Fallback to DEFAULT constants if the DB returns null or empty string
      setAppPrompt(p.app || DEFAULT_APP_PROMPT);
      setGenPrompt(p.gen || DEFAULT_PROFILE_GEN_PROMPT);
      setAnalyzePrompt(p.analyze || DEFAULT_JOB_ANALYSIS_PROMPT);
  };

  const loadAnalysisLanguage = async () => {
      const s = await api.settings.getSettings();
      if (s && s.preferred_analysis_language) {
          setAnalysisLang(s.preferred_analysis_language);
      }
  };
  
  const saveCurrentPrompt = async () => { 
      setIsSavingPrompts(true); 
      let success = false;
      if (activePromptTab === 'gen') success = await api.settings.savePrompts(undefined, genPrompt, undefined);
      if (activePromptTab === 'analyze') success = await api.settings.savePrompts(undefined, undefined, analyzePrompt);
      if (activePromptTab === 'app') success = await api.settings.savePrompts(appPrompt, undefined, undefined);
      
      // Also save analysis language preference
      await api.settings.saveAnalysisLanguage(analysisLang);

      setIsSavingPrompts(false); 
      if(success) alert("Saved!"); 
  };

  const loadAutomation = async () => {
      const settings = await api.settings.getSettings();
      if (settings) {
          setAutoEnabled(!!settings.is_auto_scan_enabled);
          setScanTime(settings.scan_time_utc || '15:00');
      }
  };

  const saveAutomation = async () => {
      setIsSavingAuto(true);
      await api.settings.saveAutomation(autoEnabled, scanTime);
      setIsSavingAuto(false);
      alert("Saved!");
  };

  const triggerManualScan = async () => {
      setScanLogs([]); 
      setIsScanning(true); 
      setScanLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] Starting manual pipeline trigger...`]);
      try {
          const res: any = await api.settings.triggerManualScan();
          if (res.success) {
              setScanLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] Success! Found ${res.jobsFound ?? 0} jobs.`]);
              alert(`Success! Found ${res.jobsFound ?? 0} jobs.`);
          } else {
              setScanLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] Failed: ${res.message}`]);
              alert("Failed: " + res.message);
          }
      } catch (error: any) {
          alert("Critical Error: " + (error.message || "Unknown error"));
      } finally {
          setIsScanning(false); 
      }
  };

  const loadKnowledgeBase = async () => {
    setIsLoadingKb(true);
    const items = await api.settings.getKnowledgeBase();
    setKbItems(items);
    setIsLoadingKb(false);
  };

  const addKbItem = async () => {
    if (!newKbQ || !newKbA) return;
    await api.settings.addKnowledgeBaseItem(newKbQ, newKbA, newKbCat);
    setNewKbQ(''); setNewKbA('');
    loadKnowledgeBase();
  };

  const deleteKbItem = async (id: string) => {
    if (confirm('Delete this item?')) {
      await api.settings.deleteKnowledgeBaseItem(id);
      loadKnowledgeBase();
    }
  };

  const renderTabs = () => (
    <div className="flex overflow-x-auto border-b border-slate-200 mb-6">
      {[
        { id: 'resume', label: t('settings.tabs.resume'), icon: Upload },
        { id: 'search', label: t('settings.tabs.search'), icon: Globe },
        { id: 'ai_config', label: t('settings.tabs.aiConfig'), icon: Bot },
        { id: 'automation', label: t('settings.tabs.automation'), icon: Zap },
        { id: 'knowledge', label: t('settings.tabs.knowledge'), icon: BookOpen },
      ].map(tab => (
        <button
          key={tab.id}
          onClick={() => setActiveTab(tab.id)}
          className={`flex items-center gap-2 px-6 py-3 border-b-2 font-medium text-sm whitespace-nowrap transition-colors ${
            activeTab === tab.id ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
        >
          <tab.icon size={16} /> {tab.label}
        </button>
      ))}
    </div>
  );

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 min-h-[calc(100vh-100px)]">
      <div className="p-6">
        <h2 className="text-xl font-bold text-slate-900 mb-6">{t('settings.title')}</h2>
        {renderTabs()}

        {/* --- Resume Tab --- */}
        {activeTab === 'resume' && (
           <div className="space-y-8">
              {dbStatus && !dbStatus.success && (
                <div className="bg-red-50 border border-red-200 p-4 rounded-lg flex items-center gap-2 text-red-700">
                   <AlertCircle size={20} /> {dbStatus.message}
                </div>
              )}

              <div className="border-2 border-dashed border-slate-300 rounded-xl p-8 text-center bg-slate-50 hover:bg-slate-100 transition-colors relative">
                 <input type="file" multiple accept=".pdf" onChange={handleFileChange} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" />
                 <div className="flex flex-col items-center gap-3"><Upload size={24} /><p>{t('settings.resume.uploadTitle')} ({files.length} selected)</p></div>
              </div>
              <div className="flex justify-end">
                  <button onClick={handleUploadAndAnalyze} disabled={isAnalyzing} className="bg-blue-600 text-white px-6 py-3 rounded-lg flex items-center gap-2">
                    {isAnalyzing && <Loader2 className="animate-spin" />} {t('settings.resume.analyzeBtn')}
                  </button>
              </div>
              {analysisResult && <div className="mt-8 animate-fade-in"><h3 className="font-bold mb-2">{t('settings.resume.previewTitle')}:</h3><div className="bg-slate-50 p-6 rounded-xl border h-[300px] overflow-y-auto whitespace-pre-wrap text-sm font-mono">{analysisResult}</div><button onClick={handleSaveProfile} className="mt-4 bg-green-600 text-white px-4 py-2 rounded">{t('settings.resume.saveProfile')}</button></div>}
              
              <div className="mt-12 pt-8 border-t">
                 <h3 className="font-bold mb-4">{t('settings.resume.savedProfiles')}</h3>
                 {isLoadingProfiles ? <Loader2 className="animate-spin" /> : profiles.map(p => (
                    <div key={p.id} className={`p-4 mb-3 rounded-lg border flex justify-between items-center ${p.isActive ? 'bg-blue-50 border-blue-200' : 'bg-white hover:bg-slate-50'}`}>
                       <div className="flex items-center gap-3">
                           <div className={`p-2 rounded-full ${p.isActive ? 'bg-blue-100 text-blue-600' : 'bg-slate-100 text-slate-400'}`}><User size={20}/></div>
                           <div>
                               <div className="font-medium text-slate-900">{p.name} {p.isActive && <span className="bg-blue-200 text-blue-800 text-[10px] px-2 py-0.5 rounded-full ml-2 uppercase font-bold">{t('settings.resume.activeBadge')}</span>}</div>
                               <div className="text-xs text-slate-500">{new Date(p.createdAt).toLocaleDateString()} • {p.resumeCount} sources</div>
                           </div>
                       </div>
                       <div className="flex gap-2">
                          <button onClick={() => setViewingProfile(p)} className="text-xs border px-3 py-1.5 rounded bg-white hover:bg-slate-50 text-slate-600 flex items-center gap-1"><Eye size={14}/> {t('settings.resume.viewContent')}</button>
                          {!p.isActive && <button onClick={() => handleSetActive(p.id)} className="text-xs border px-3 py-1.5 rounded hover:bg-blue-50 text-blue-600 border-blue-200">{t('settings.resume.setActive')}</button>}
                          <button onClick={() => handleDelete(p.id)} className="text-red-400 hover:text-red-600 p-1.5"><Trash2 size={16} /></button>
                       </div>
                    </div>
                 ))}
              </div>
           </div>
        )}

        {/* --- VIEW PROFILE MODAL --- */}
        {viewingProfile && (
            <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                <div className="bg-white rounded-xl w-full max-w-4xl max-h-[90vh] flex flex-col shadow-2xl">
                    <div className="p-4 border-b flex justify-between items-center bg-slate-50 rounded-t-xl">
                        <h3 className="font-bold text-lg text-slate-800">{viewingProfile.name}</h3>
                        <button onClick={() => setViewingProfile(null)} className="text-slate-400 hover:text-slate-700"><X size={24} /></button>
                    </div>
                    <div className="p-6 overflow-y-auto flex-1 grid grid-cols-1 md:grid-cols-3 gap-6">
                        <div className="md:col-span-2 space-y-2">
                            <label className="text-xs font-bold text-slate-500 uppercase">Profile Content</label>
                            <div className="bg-slate-50 p-4 rounded-lg border border-slate-200 text-sm font-mono whitespace-pre-wrap h-full">{viewingProfile.content}</div>
                        </div>
                        <div className="space-y-2">
                             <label className="text-xs font-bold text-slate-500 uppercase">Source Files</label>
                             <div className="bg-slate-50 p-4 rounded-lg border border-slate-200 min-h-[200px]">
                                 {viewingProfile.sourceFiles && viewingProfile.sourceFiles.length > 0 ? (
                                     <ul className="space-y-2">
                                         {viewingProfile.sourceFiles.map((f, i) => (
                                             <li key={i} className="flex items-center gap-2 text-xs text-slate-700 p-2 bg-white border rounded">
                                                 <FileText size={14} className="text-blue-500" /> {f}
                                             </li>
                                         ))}
                                     </ul>
                                 ) : <span className="text-slate-400 italic text-sm">No file names recorded.</span>}
                             </div>
                        </div>
                    </div>
                    <div className="p-4 border-t flex justify-end">
                        <button onClick={() => setViewingProfile(null)} className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg font-medium">Close</button>
                    </div>
                </div>
            </div>
        )}

        {/* --- Search Tab --- */}
        {activeTab === 'search' && (
           <div className="space-y-6 animate-fade-in">
              <div><h3 className="text-lg font-bold text-slate-800">{t('settings.search.title')}</h3></div>
              <div className="flex gap-2">
                  <input value={newUrl} onChange={e => setNewUrl(e.target.value)} placeholder={t('settings.search.placeholder')} className="border p-2 rounded-lg flex-1 text-sm" />
                  <button onClick={addUrl} className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 font-medium">{t('settings.search.add')}</button>
              </div>
              <div className="bg-slate-50 rounded-lg border border-slate-200 divide-y divide-slate-200">
                {searchUrls.map((u, i) => (
                    <div key={i} className="flex justify-between p-3 items-center hover:bg-white transition-colors">
                        <div className="flex items-center gap-3 overflow-hidden"><span className="bg-slate-200 text-[10px] px-2 py-1 rounded font-bold">LINK</span> <span className="text-sm text-slate-600 truncate">{u}</span></div>
                        <button onClick={() => removeUrl(i)} className="text-slate-400 hover:text-red-500"><Trash2 size={14} /></button>
                    </div>
                ))}
              </div>
              <div className="flex justify-end"><button onClick={saveUrls} disabled={isSavingUrls} className="bg-green-600 text-white px-6 py-2 rounded-lg">{isSavingUrls ? 'Saving...' : t('settings.search.save')}</button></div>
           </div>
        )}

        {/* --- AI Configuration Tab --- */}
        {activeTab === 'ai_config' && (
           <div className="space-y-6 max-w-5xl animate-fade-in">
              <div className="flex justify-between items-center">
                  <div>
                     <h3 className="text-lg font-semibold text-slate-800 mb-1">{t('settings.aiConfig.title')}</h3>
                     <p className="text-slate-500 text-sm">{t('settings.aiConfig.subtitle')}</p>
                  </div>
                  <div className="flex bg-slate-100 p-1 rounded-lg">
                     {(['gen', 'analyze', 'app'] as const).map(tKey => (
                        <button 
                           key={tKey} 
                           onClick={() => setActivePromptTab(tKey)}
                           className={`px-4 py-2 rounded-md text-xs font-bold transition-all ${activePromptTab === tKey ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                        >
                           {tKey === 'gen' ? t('settings.aiConfig.genTab') : tKey === 'analyze' ? t('settings.aiConfig.analyzeTab') : t('settings.aiConfig.appTab')}
                        </button>
                     ))}
                  </div>
              </div>

              {/* AI Language Setting */}
              <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4 flex items-center justify-between">
                  <div>
                      <h4 className="font-bold text-yellow-800 text-sm flex items-center gap-2"><Globe size={16}/> {t('settings.aiConfig.analysisLangTitle')}</h4>
                      <p className="text-xs text-yellow-700 mt-1">{t('settings.aiConfig.analysisLangDesc')}</p>
                  </div>
                  <select 
                    value={analysisLang} 
                    onChange={(e) => setAnalysisLang(e.target.value as Language)} 
                    className="border border-yellow-300 rounded px-3 py-1.5 text-sm"
                  >
                      <option value="uk">Ukrainian (Українська)</option>
                      <option value="no">Norwegian (Norsk)</option>
                      <option value="en">English</option>
                  </select>
              </div>

              {activePromptTab === 'gen' && (
                 <div className="space-y-2">
                    <textarea value={genPrompt} onChange={(e) => setGenPrompt(e.target.value)} className="w-full h-[500px] p-4 text-sm border border-slate-200 rounded-lg font-mono" placeholder={DEFAULT_PROFILE_GEN_PROMPT} />
                 </div>
              )}

              {activePromptTab === 'analyze' && (
                 <div className="space-y-2">
                    <textarea value={analyzePrompt} onChange={(e) => setAnalyzePrompt(e.target.value)} className="w-full h-[500px] p-4 text-sm border border-slate-200 rounded-lg font-mono" placeholder={DEFAULT_JOB_ANALYSIS_PROMPT} />
                 </div>
              )}

              {activePromptTab === 'app' && (
                 <div className="space-y-2">
                    <textarea value={appPrompt} onChange={(e) => setAppPrompt(e.target.value)} className="w-full h-[500px] p-4 text-sm border border-slate-200 rounded-lg font-mono" placeholder={DEFAULT_APP_PROMPT} />
                 </div>
              )}

              <div className="flex justify-end pt-4 border-t">
                  <button onClick={saveCurrentPrompt} disabled={isSavingPrompts} className="flex items-center gap-2 bg-blue-600 text-white px-6 py-3 rounded-lg hover:bg-blue-700 font-medium shadow-md">
                      {isSavingPrompts ? <Loader2 className="animate-spin" /> : <Save size={18} />} {t('settings.aiConfig.savePrompt')}
                  </button>
              </div>
           </div>
        )}

        {/* --- Automation Tab --- */}
        {activeTab === 'automation' && (
           <div className="max-w-2xl space-y-8 animate-fade-in">
              <div className="bg-slate-900 text-white p-6 rounded-xl">
                  <h3 className="text-lg font-bold mb-4 flex items-center gap-2"><Bot/> {t('settings.automation.title')}</h3>
                  <div className="flex items-center justify-between bg-slate-800 p-4 rounded-lg mb-4">
                      <span>{t('settings.automation.enable')}</span>
                      <input type="checkbox" checked={autoEnabled} onChange={e => setAutoEnabled(e.target.checked)} className="w-5 h-5" />
                  </div>
                  <div className="flex items-center justify-between bg-slate-800 p-4 rounded-lg">
                      <span><Clock size={18} className="inline mr-2"/> {t('settings.automation.runTime')}</span>
                      <input type="time" value={scanTime} onChange={e => setScanTime(e.target.value)} className="bg-slate-700 text-white p-2 rounded" />
                  </div>
              </div>
              <div className="flex justify-between">
                   <button onClick={triggerManualScan} disabled={isScanning} className="border p-2 rounded flex gap-2 items-center hover:bg-slate-50">{isScanning ? <Loader2 className="animate-spin"/> : <Play size={16}/>} {t('settings.automation.runTest')}</button>
                   <button onClick={saveAutomation} disabled={isSavingAuto} className="bg-blue-600 text-white px-6 py-2 rounded-lg">{isSavingAuto ? 'Saving...' : t('settings.automation.save')}</button>
              </div>
              {/* Log Window */}
              <div className="bg-slate-950 text-slate-300 p-4 rounded-lg font-mono text-xs h-[200px] overflow-y-auto border border-slate-800">
                  <div className="border-b border-slate-800 pb-2 mb-2 text-slate-500">{t('settings.automation.debug')}</div>
                  {scanLogs.length === 0 ? <i className="text-slate-600">Ready...</i> : scanLogs.map((l, i) => <div key={i}>{l}</div>)}
              </div>
           </div>
        )}

        {/* --- Knowledge Base --- */}
        {activeTab === 'knowledge' && (
          <div className="max-w-4xl space-y-6 animate-fade-in">
            <div><h3 className="text-lg font-bold">{t('settings.knowledge.title')}</h3></div>
            <div className="bg-slate-50 p-4 rounded-lg grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
              <div className="md:col-span-4"><label className="text-xs font-bold">{t('settings.knowledge.question')}</label><input className="w-full text-sm border p-2 rounded" value={newKbQ} onChange={e => setNewKbQ(e.target.value)} /></div>
              <div className="md:col-span-5"><label className="text-xs font-bold">{t('settings.knowledge.answer')}</label><input className="w-full text-sm border p-2 rounded" value={newKbA} onChange={e => setNewKbA(e.target.value)} /></div>
              <div className="md:col-span-2"><label className="text-xs font-bold">{t('settings.knowledge.category')}</label><select className="w-full text-sm border p-2 rounded" value={newKbCat} onChange={e => setNewKbCat(e.target.value)}><option value="general">General</option><option value="personal">Personal</option><option value="urls">URLs</option></select></div>
              <div className="md:col-span-1"><button onClick={addKbItem} className="w-full bg-blue-600 text-white py-2 rounded"><Plus size={20} className="mx-auto" /></button></div>
            </div>
            {isLoadingKb ? <Loader2 className="animate-spin" /> : (
              <table className="w-full text-sm text-left border rounded-lg overflow-hidden">
                  <thead className="bg-slate-100"><tr><th className="p-3">Q</th><th className="p-3">A</th><th className="p-3">Cat</th><th className="p-3"></th></tr></thead>
                  <tbody>{kbItems.map(item => (<tr key={item.id} className="border-t"><td className="p-3 font-medium">{item.question}</td><td className="p-3">{item.answer}</td><td className="p-3">{item.category}</td><td className="p-3 text-right"><button onClick={() => deleteKbItem(item.id)} className="text-red-500"><Trash2 size={16}/></button></td></tr>))}</tbody>
              </table>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
