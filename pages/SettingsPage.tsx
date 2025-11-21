
import React, { useState, useEffect } from 'react';
import { 
  User, FileText, Globe, Briefcase, Lock, Save, Upload, 
  Trash2, Play, CheckCircle, AlertCircle, Loader2, Edit2, Plus, Database, Key, ExternalLink, Bot, PenTool, Clock, Zap, BookOpen, Terminal
} from 'lucide-react';
import { api } from '../services/api';
import { CVProfile, KnowledgeBaseItem } from '../types';

interface SettingsPageProps {
  initialTab?: string;
}

const DEFAULT_SYSTEM_PROMPT = `You are a Candidate Profile Analyst AI...`; 
const DEFAULT_USER_PROMPT = `I will provide multiple resumes...`;

const DEFAULT_APP_PROMPT = `
Ти — експерт з написання мотиваційних листів для вакансій в Норвегії.

ВАКАНСІЯ:
[Опис вакансії буде тут]

КАНДИДАТ:
[Активний профіль кандидата буде тут]

ЗАВДАННЯ:
Напиши професійний, адаптований до вакансії søknad (мотиваційний лист) норвезькою мовою (Bokmål).

ВИМОГИ:
- Офіційний, але дружній тон
- Підкреслити релевантний досвід і навички (витягнути з профілю)
- Показати мотивацію та релевантність до специфічних вимог
- Довжина: 200-300 слів
- Використовуй структуру: Вступ, Тіло (досвід), Заключення.

ФОРМАТ ВІДПОВІДІ (JSON):
{
  "soknad_no": "Текст листа норвезькою...",
  "translation_uk": "Переклад українською (для розуміння)..."
}
`;

export const SettingsPage: React.FC<SettingsPageProps> = ({ initialTab = 'resume' }) => {
  const [activeTab, setActiveTab] = useState(initialTab);
  
  // State Variables
  const [files, setFiles] = useState<File[]>([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<string>('');
  const [profiles, setProfiles] = useState<CVProfile[]>([]);
  const [isLoadingProfiles, setIsLoadingProfiles] = useState(false);
  const [dbStatus, setDbStatus] = useState<{ success: boolean; message: string } | null>(null);
  
  const [searchUrls, setSearchUrls] = useState<string[]>([]);
  const [newUrl, setNewUrl] = useState('');
  const [isSavingUrls, setIsSavingUrls] = useState(false);
  const [isLoadingUrls, setIsLoadingUrls] = useState(false);

  const [appPrompt, setAppPrompt] = useState(DEFAULT_APP_PROMPT);
  const [isSavingAppPrompt, setIsSavingAppPrompt] = useState(false);

  // Automation State
  const [autoEnabled, setAutoEnabled] = useState(false);
  const [scanTime, setScanTime] = useState('15:00');
  const [isSavingAuto, setIsSavingAuto] = useState(false);
  const [isScanning, setIsScanning] = useState(false); // Loading state for manual scan
  const [scanLogs, setScanLogs] = useState<string[]>([]); // ON-SCREEN LOGS

  // Knowledge Base State
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
    }
    if (activeTab === 'search') loadSearchUrls();
    if (activeTab === 'app') loadAppPrompt();
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
          const result = await api.cv.analyzeResumes(paths, DEFAULT_SYSTEM_PROMPT, DEFAULT_USER_PROMPT);
          setAnalysisResult(result);
      } else {
          setAnalysisResult("Failed to upload files.");
      }
      setIsAnalyzing(false);
  };

  const handleSaveProfile = async () => { 
      const name = `Profile ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()}`;
      await api.cv.saveProfile(name, analysisResult, files.length);
      loadProfiles();
  };
  
  const handleSetActive = async (id: string) => { await api.cv.setProfileActive(id); loadProfiles(); };
  const handleDelete = async (id: string) => { await api.cv.deleteProfile(id); loadProfiles(); };
  const loadSearchUrls = async () => { setIsLoadingUrls(true); setSearchUrls(await api.settings.getSearchUrls()); setIsLoadingUrls(false); };
  const addUrl = () => { if (newUrl) setSearchUrls([...searchUrls, newUrl]); setNewUrl(''); };
  const removeUrl = (i: number) => { const u = [...searchUrls]; u.splice(i, 1); setSearchUrls(u); };
  const saveUrls = async () => { setIsSavingUrls(true); await api.settings.saveSearchUrls(searchUrls); setIsSavingUrls(false); };

  const loadAppPrompt = async () => { const p = await api.settings.getApplicationPrompt(); if (p) setAppPrompt(p); };
  const saveAppPrompt = async () => { setIsSavingAppPrompt(true); const s = await api.settings.saveApplicationPrompt(appPrompt); setIsSavingAppPrompt(false); if(s) alert("Prompt saved!"); };

  // Automation Functions
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
      alert("Automation settings saved!");
  };

  const addLog = (msg: string) => {
      setScanLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`]);
  };

  const triggerManualScan = async () => {
      setScanLogs([]); // Clear logs
      setIsScanning(true); 
      addLog("🚀 Starting manual pipeline trigger...");
      
      try {
          addLog("📡 Sending request to Supabase Edge Function 'scheduled-scanner'...");
          
          await new Promise(r => setTimeout(r, 100));

          const res: any = await api.settings.triggerManualScan();
          
          if (res.success) {
              addLog("✅ Function returned SUCCESS.");
              if (res.jobsFound !== undefined) addLog(`📦 Jobs Found: ${res.jobsFound}`);
              if (res.jobsAnalyzed !== undefined) addLog(`🤖 Jobs Analyzed: ${res.jobsAnalyzed}`);
              addLog(`📩 Message: ${res.message}`);
              alert(`✅ Success! Found ${res.jobsFound ?? 0} jobs.`);
          } else {
              addLog("❌ Function returned ERROR.");
              addLog(`⚠️ Message: ${res.message}`);
              alert("❌ Failed: " + res.message);
          }
      } catch (error: any) {
          console.error("Frontend Scan Error:", error);
          addLog(`🔥 CRITICAL EXCEPTION: ${error.message}`);
          alert("Critical Error: " + (error.message || "Unknown error"));
      } finally {
          setIsScanning(false); 
          addLog("🏁 Process finished.");
      }
  };

  // Knowledge Base Functions
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
        { id: 'profile', label: 'Profile', icon: User },
        { id: 'resume', label: 'Resume Upload & AI', icon: Upload },
        { id: 'search', label: 'Job Search URLs', icon: Globe },
        { id: 'app', label: 'Application Prompt', icon: Briefcase },
        { id: 'automation', label: 'Automation', icon: Zap },
        { id: 'knowledge', label: 'Knowledge Base', icon: BookOpen },
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
        <h2 className="text-xl font-bold text-slate-900 mb-6">Settings</h2>
        {renderTabs()}

        {/* --- Resume Tab --- */}
        {activeTab === 'resume' && (
           <div className="space-y-8">
              {dbStatus && !dbStatus.success && (
                <div className="bg-red-50 border border-red-200 p-4 rounded-lg flex items-center gap-2 text-red-700">
                   <AlertCircle size={20} /> {dbStatus.message}
                </div>
              )}
              {dbStatus && dbStatus.success && (
                <div className="bg-green-50 border border-green-200 p-2 rounded-lg flex items-center gap-2 text-green-700 text-sm justify-center">
                   <CheckCircle size={16} /> {dbStatus.message}
                </div>
              )}

              <div className="border-2 border-dashed border-slate-300 rounded-xl p-8 text-center bg-slate-50 hover:bg-slate-100 transition-colors relative">
                 <input type="file" multiple accept=".pdf" onChange={handleFileChange} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" />
                 <div className="flex flex-col items-center gap-3"><Upload size={24} /><p>Click to upload ({files.length} selected)</p></div>
              </div>
              <div className="flex justify-end">
                  <button onClick={handleUploadAndAnalyze} disabled={isAnalyzing} className="bg-blue-600 text-white px-6 py-3 rounded-lg flex items-center gap-2">
                    {isAnalyzing && <Loader2 className="animate-spin" />} Analyze Resumes
                  </button>
              </div>
              {analysisResult && <div className="mt-8"><div className="bg-slate-50 p-6 rounded-xl border h-[500px] overflow-y-auto whitespace-pre-wrap">{analysisResult}</div><button onClick={handleSaveProfile} className="mt-4 bg-green-600 text-white px-4 py-2 rounded">Save Profile</button></div>}
              <div className="mt-12 pt-8 border-t">
                 <h3 className="font-bold mb-4">Saved Profiles</h3>
                 {isLoadingProfiles ? <Loader2 className="animate-spin" /> : profiles.map(p => (
                    <div key={p.id} className={`p-4 mb-3 rounded border flex justify-between ${p.isActive ? 'bg-blue-50 border-blue-200' : ''}`}>
                       <div><b>{p.name}</b> {p.isActive && <span className="bg-blue-200 text-xs px-2 rounded ml-2">Active</span>}</div>
                       <div className="flex gap-2">
                          {!p.isActive && <button onClick={() => handleSetActive(p.id)} className="text-xs border px-2 rounded hover:bg-slate-50">Set Active</button>}
                          <button onClick={() => handleDelete(p.id)} className="text-red-500"><Trash2 size={16} /></button>
                       </div>
                    </div>
                 ))}
              </div>
           </div>
        )}

        {/* --- Search Tab --- */}
        {activeTab === 'search' && (
           <div className="space-y-6 animate-fade-in">
              <div>
                <h3 className="text-lg font-bold text-slate-800">Search Sources</h3>
                <p className="text-sm text-slate-500">Add URLs from FINN.no or NAV.no (arbeidsplassen) to scan.</p>
              </div>
              
              <div className="flex gap-2">
                  <input 
                    value={newUrl} 
                    onChange={e => setNewUrl(e.target.value)} 
                    placeholder="e.g. https://www.finn.no/job/fulltime/search.html?q=react or https://arbeidsplassen.nav.no/stillinger?q=developer" 
                    className="border p-2 rounded-lg flex-1 text-sm focus:ring-2 focus:ring-blue-500 outline-none" 
                  />
                  <button onClick={addUrl} className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 font-medium">Add</button>
              </div>
              
              <div className="bg-slate-50 rounded-lg border border-slate-200 divide-y divide-slate-200">
                {searchUrls.length === 0 && <p className="p-4 text-center text-slate-400 text-sm italic">No URLs added yet.</p>}
                {searchUrls.map((u, i) => (
                    <div key={i} className="flex justify-between p-3 items-center hover:bg-white transition-colors group">
                        <div className="flex items-center gap-3 overflow-hidden">
                            {u.includes('finn.no') ? 
                                <span className="bg-blue-100 text-blue-700 text-[10px] font-bold px-2 py-1 rounded uppercase tracking-wide">FINN</span> : 
                             u.includes('nav.no') ?
                                <span className="bg-red-100 text-red-700 text-[10px] font-bold px-2 py-1 rounded uppercase tracking-wide">NAV</span> :
                                <span className="bg-slate-100 text-slate-600 text-[10px] font-bold px-2 py-1 rounded uppercase tracking-wide">OTHER</span>
                            }
                            <a href={u} target="_blank" rel="noreferrer" className="text-sm text-slate-600 truncate hover:text-blue-600 hover:underline flex items-center gap-1">
                                {u} <ExternalLink size={12} className="opacity-0 group-hover:opacity-100 transition-opacity" />
                            </a>
                        </div>
                        <button onClick={() => removeUrl(i)} className="text-slate-400 hover:text-red-500 p-1"><Trash2 size={14} /></button>
                    </div>
                ))}
              </div>
              
              <div className="flex justify-end">
                  <button onClick={saveUrls} disabled={isSavingUrls} className="bg-green-600 text-white px-6 py-2 rounded-lg hover:bg-green-700 flex items-center gap-2 font-medium">
                      {isSavingUrls ? <Loader2 className="animate-spin" size={16} /> : <Save size={16} />}
                      {isSavingUrls ? 'Saving...' : 'Save Configuration'}
                  </button>
              </div>
           </div>
        )}

        {/* --- Application Prompt Tab --- */}
        {activeTab === 'app' && (
           <div className="space-y-6 max-w-4xl">
              <div><h3 className="text-lg font-semibold text-slate-800 mb-1">Application Generation Prompt</h3><p className="text-slate-500 text-sm">Customize the instruction sent to AI.</p></div>
              <div className="bg-green-50 border border-green-100 rounded-xl p-4 flex gap-3 text-green-800 text-sm"><PenTool className="shrink-0 mt-0.5" size={18} /><div><p className="font-bold mb-1">How it works</p><p>Combines: Job Description + Active Profile + This Prompt</p></div></div>
              <div className="space-y-2"><textarea value={appPrompt} onChange={(e) => setAppPrompt(e.target.value)} className="w-full h-96 p-4 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-green-500 bg-slate-50 font-mono leading-relaxed" /></div>
              <div className="flex justify-end pt-4"><button onClick={saveAppPrompt} disabled={isSavingAppPrompt} className="flex items-center gap-2 bg-green-600 text-white px-6 py-3 rounded-lg hover:bg-green-700 font-medium shadow-md transition-all disabled:opacity-70">{isSavingAppPrompt ? <Loader2 className="animate-spin" /> : <Save size={18} />} Save Active Prompt</button></div>
           </div>
        )}

        {/* --- Automation Tab --- */}
        {activeTab === 'automation' && (
           <div className="max-w-2xl space-y-8 animate-fade-in">
              <div className="bg-slate-900 text-white p-6 rounded-xl">
                  <div className="flex items-center gap-3 mb-4">
                      <div className="p-2 bg-blue-600 rounded-lg"><Bot size={24} /></div>
                      <div>
                          <h3 className="text-lg font-bold">Scheduled Scanner</h3>
                          <p className="text-slate-400 text-sm">Configure when the bot should run automatically.</p>
                      </div>
                  </div>
                  
                  <div className="flex items-center justify-between bg-slate-800 p-4 rounded-lg mb-4">
                      <span className="font-medium">Enable Auto-Scanning</span>
                      <label className="relative inline-flex items-center cursor-pointer">
                          <input type="checkbox" checked={autoEnabled} onChange={e => setAutoEnabled(e.target.checked)} className="sr-only peer" />
                          <div className="w-11 h-6 bg-slate-600 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-800 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                      </label>
                  </div>

                  <div className="flex items-center justify-between bg-slate-800 p-4 rounded-lg">
                      <span className="font-medium flex items-center gap-2"><Clock size={18} /> Daily Run Time (Europe/Oslo)</span>
                      <input 
                        type="time" 
                        value={scanTime} 
                        onChange={e => setScanTime(e.target.value)}
                        className="bg-slate-700 border border-slate-600 text-white text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block p-2.5" 
                      />
                  </div>
                  <p className="text-xs text-slate-400 mt-2 pl-1">The scanner runs hourly but will only process jobs if the current Norway time matches your setting.</p>
              </div>

              {/* Manual Trigger Area */}
              <div className="space-y-4">
                <div className="flex justify-between items-center pt-4">
                    <button onClick={triggerManualScan} disabled={isScanning} className="bg-white border border-slate-300 text-slate-700 hover:bg-slate-50 hover:text-blue-600 flex items-center gap-2 text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-50 shadow-sm transition-all">
                        {isScanning ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} />} 
                        {isScanning ? "Running Pipeline..." : "Run Pipeline Now (Test)"}
                    </button>

                    <button 
                        onClick={saveAutomation}
                        disabled={isSavingAuto}
                        className="flex items-center gap-2 bg-blue-600 text-white px-6 py-3 rounded-lg hover:bg-blue-700 font-medium shadow-md transition-all disabled:opacity-70"
                    >
                        {isSavingAuto ? <Loader2 className="animate-spin" /> : <Save size={18} />}
                        Save Schedule
                    </button>
                </div>

                {/* ON-SCREEN DEBUG CONSOLE */}
                <div className="bg-slate-950 rounded-lg p-4 font-mono text-xs text-slate-300 min-h-[120px] max-h-[300px] overflow-y-auto border border-slate-800 shadow-inner">
                    <div className="flex items-center gap-2 text-slate-500 mb-2 border-b border-slate-800 pb-1">
                        <Terminal size={12} /> <span>Debug Output</span>
                    </div>
                    {scanLogs.length === 0 ? (
                        <span className="text-slate-600 italic">Waiting for command... Press 'Run Pipeline' to see logs here.</span>
                    ) : (
                        scanLogs.map((log, i) => (
                            <div key={i} className={`${log.includes('ERROR') || log.includes('CRITICAL') ? 'text-red-400' : log.includes('SUCCESS') ? 'text-green-400' : 'text-slate-300'} mb-1`}>
                                {log}
                            </div>
                        ))
                    )}
                </div>
              </div>
           </div>
        )}

        {/* --- Knowledge Base Tab (NEW) --- */}
        {activeTab === 'knowledge' && (
          <div className="max-w-4xl space-y-6 animate-fade-in">
            <div>
              <h3 className="text-lg font-bold text-slate-900">Knowledge Base</h3>
              <p className="text-sm text-slate-500">Teach the AI how to answer common application questions.</p>
            </div>

            {/* Add New Item */}
            <div className="bg-slate-50 p-4 rounded-lg border border-slate-200 grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
              <div className="md:col-span-4">
                <label className="text-xs font-bold text-slate-700 mb-1 block">Question / Field Name</label>
                <input 
                  className="w-full text-sm border p-2 rounded" 
                  placeholder="e.g. Notice Period" 
                  value={newKbQ} onChange={e => setNewKbQ(e.target.value)} 
                />
              </div>
              <div className="md:col-span-5">
                <label className="text-xs font-bold text-slate-700 mb-1 block">Answer / Value</label>
                <input 
                  className="w-full text-sm border p-2 rounded" 
                  placeholder="e.g. 3 months" 
                  value={newKbA} onChange={e => setNewKbA(e.target.value)} 
                />
              </div>
              <div className="md:col-span-2">
                 <label className="text-xs font-bold text-slate-700 mb-1 block">Category</label>
                 <select 
                    className="w-full text-sm border p-2 rounded"
                    value={newKbCat} onChange={e => setNewKbCat(e.target.value)}
                 >
                    <option value="general">General</option>
                    <option value="personal">Personal</option>
                    <option value="urls">URLs</option>
                    <option value="experience">Experience</option>
                 </select>
              </div>
              <div className="md:col-span-1">
                 <button onClick={addKbItem} className="w-full bg-blue-600 text-white py-2 rounded hover:bg-blue-700"><Plus size={20} className="mx-auto" /></button>
              </div>
            </div>

            {/* List Items */}
            {isLoadingKb ? <Loader2 className="animate-spin" /> : (
              <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
                <table className="w-full text-sm text-left">
                  <thead className="bg-slate-50 text-slate-500 font-medium border-b">
                    <tr>
                      <th className="p-3">Question</th>
                      <th className="p-3">Answer</th>
                      <th className="p-3">Category</th>
                      <th className="p-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {kbItems.map(item => (
                      <tr key={item.id} className="hover:bg-slate-50">
                        <td className="p-3 font-medium text-slate-800">{item.question}</td>
                        <td className="p-3 text-slate-600">{item.answer}</td>
                        <td className="p-3"><span className="px-2 py-1 bg-slate-100 text-xs rounded-full text-slate-600 capitalize">{item.category}</span></td>
                        <td className="p-3 text-right">
                          <button onClick={() => deleteKbItem(item.id)} className="text-red-400 hover:text-red-600"><Trash2 size={16} /></button>
                        </td>
                      </tr>
                    ))}
                    {kbItems.length === 0 && <tr><td colSpan={4} className="p-6 text-center text-slate-400">No items yet. Add one above!</td></tr>}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
