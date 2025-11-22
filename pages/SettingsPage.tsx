
import React, { useState, useEffect } from 'react';
import { 
  User, FileText, Globe, Briefcase, Lock, Save, Upload, 
  Trash2, Play, CheckCircle, AlertCircle, Loader2, Edit2, Plus, Database, Key, ExternalLink, Bot, PenTool, Clock, Zap, BookOpen, Terminal, Eye, X, StickyNote, RefreshCw, Wand2
} from 'lucide-react';
import { api, generateProfileTextFromJSON } from '../services/api';
import { CVProfile, KnowledgeBaseItem, StructuredProfile } from '../types';
import { useLanguage } from '../contexts/LanguageContext';
import { Language } from '../services/translations';
import { ProfileEditor } from '../components/ProfileEditor';

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

// EXACT JSON SCHEMA FOR UPGRADE
const UPGRADE_PROMPT = `
TASK: Extract structured data from the provided legacy resume text and populate the JSON schema.
CRITICAL: Output MUST be valid JSON matching this exact schema. Do not make up data if not present, but try to infer reasonable values from context.

OUTPUT JSON FORMAT:
{
  "personalInfo": {
    "fullName": "string", "email": "string", "phone": "string", 
    "website": "string", "address": { "city": "string", "country": "string" }
  },
  "professionalSummary": "string (Comprehensive summary)",
  "workExperience": [
    { "company": "string", "position": "string", "startDate": "string", "endDate": "string", "responsibilities": ["string", "string"] }
  ],
  "education": [ { "institution": "string", "degree": "string", "field": "string", "graduationYear": "string" } ],
  "technicalSkills": {
    "aiTools": ["string"], "programmingLanguages": ["string"], "frameworks": ["string"], "databases": ["string"], "cloudPlatforms": ["string"], "developmentTools": ["string"], "other": ["string"]
  },
  "softSkills": ["string"],
  "languages": [ { "language": "string", "proficiencyLevel": "string" } ],
  "certifications": ["string"],
  "interests": ["string"]
}
`;

// Helper to create blank profile
const createBlankProfile = (): StructuredProfile => ({
    personalInfo: { fullName: '', email: '', phone: '', website: '', address: { city: '', country: '' } },
    professionalSummary: '',
    workExperience: [],
    education: [],
    technicalSkills: { aiTools: [], programmingLanguages: [], frameworks: [], databases: [], cloudPlatforms: [], developmentTools: [], other: [] },
    softSkills: [],
    languages: [],
    certifications: [],
    interests: []
});

interface SettingsPageProps {
  initialTab?: string;
}

export const SettingsPage: React.FC<SettingsPageProps> = ({ initialTab = 'resume' }) => {
  const { t } = useLanguage();
  const [activeTab, setActiveTab] = useState(initialTab);
  
  // State Variables
  const [files, setFiles] = useState<File[]>([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisStatus, setAnalysisStatus] = useState<string>('');
  const [profiles, setProfiles] = useState<CVProfile[]>([]);
  const [isLoadingProfiles, setIsLoadingProfiles] = useState(false);
  const [dbStatus, setDbStatus] = useState<{ success: boolean; message: string } | null>(null);
  
  // Profile Tab State
  const [activeProfileData, setActiveProfileData] = useState<CVProfile | null>(null);
  const [isLoadingActive, setIsLoadingActive] = useState(false);
  const [structuredData, setStructuredData] = useState<StructuredProfile>(createBlankProfile());
  const [isUpgradingProfile, setIsUpgradingProfile] = useState(false); // For Legacy -> JSON conversion
  
  // Editor State (Modal)
  const [editingProfile, setEditingProfile] = useState<CVProfile | null>(null);
  const [parsedJson, setParsedJson] = useState<StructuredProfile | null>(null);

  // ... (Keep other existing states for searchUrls, prompts, automation) ...
  const [searchUrls, setSearchUrls] = useState<string[]>([]);
  const [newUrl, setNewUrl] = useState('');
  const [isSavingUrls, setIsSavingUrls] = useState(false);
  const [isLoadingUrls, setIsLoadingUrls] = useState(false);

  const [appPrompt, setAppPrompt] = useState(DEFAULT_APP_PROMPT);
  const [genPrompt, setGenPrompt] = useState(DEFAULT_PROFILE_GEN_PROMPT);
  const [analyzePrompt, setAnalyzePrompt] = useState(DEFAULT_JOB_ANALYSIS_PROMPT);
  const [isSavingPrompts, setIsSavingPrompts] = useState(false);
  const [activePromptTab, setActivePromptTab] = useState<'gen' | 'analyze' | 'app'>('gen');

  const [analysisLang, setAnalysisLang] = useState<Language>('uk');

  const [autoEnabled, setAutoEnabled] = useState(false);
  const [scanTime, setScanTime] = useState('15:00');
  const [isSavingAuto, setIsSavingAuto] = useState(false);
  const [isScanning, setIsScanning] = useState(false); 
  const [scanLogs, setScanLogs] = useState<string[]>([]);

  // Load Active Profile Logic
  useEffect(() => { setActiveTab(initialTab); }, [initialTab]);
  useEffect(() => {
    if (activeTab === 'resume') { checkDb(); loadProfiles(); }
    if (activeTab === 'profile') { loadActiveProfile(); }
    if (activeTab === 'search') loadSearchUrls();
    if (activeTab === 'ai_config') { loadPrompts(); loadAnalysisLanguage(); }
    if (activeTab === 'automation') loadAutomation();
  }, [activeTab]);

  const checkDb = async () => { const status = await api.cv.verifyDatabaseConnection(); setDbStatus(status); };
  const loadProfiles = async () => { setIsLoadingProfiles(true); const data = await api.cv.getProfiles(); setProfiles(data); setIsLoadingProfiles(false); };
  
  // --- UPDATED: Load Active Profile with Auto-Upgrade logic ---
  const loadActiveProfile = async () => {
      setIsLoadingActive(true);
      try {
          const profile = await api.cv.getActiveProfile();
          if (profile) {
              setActiveProfileData(profile);
              
              // Check if we have meaningful structured data (not just empty template)
              const hasRealData = profile.structured_content && 
                                  (profile.structured_content.personalInfo?.fullName || 
                                   (profile.structured_content.workExperience && profile.structured_content.workExperience.length > 0));

              if (hasRealData) {
                  // Case 1: Profile is already structured and has data
                  console.log("Loaded structured data");
                  setStructuredData(profile.structured_content!);
              } else if (profile.content && profile.content.length > 50) {
                  // Case 2: Legacy Profile (Text only) OR Blank Template. 
                  // We need to upgrade it automatically from the text.
                  console.log("Detected legacy/empty structured data. Triggering upgrade...");
                  if (!isUpgradingProfile) {
                      handleUpgradeLegacyProfile(profile.content, profile.id);
                  }
              } else {
                  // Case 3: Truly empty
                  setStructuredData(createBlankProfile());
              }
          } else {
              setActiveProfileData(null);
              setStructuredData(createBlankProfile());
          }
      } catch (e) {
          console.error("Load Profile Error", e);
      } finally {
          setIsLoadingActive(false);
      }
  };

  // --- NEW: Upgrade Legacy Profile Function ---
  const handleUpgradeLegacyProfile = async (text: string, id: string) => {
      if (!text || text.length < 20) return;
      
      setIsUpgradingProfile(true);
      try {
          // Call AI with the Raw Text and EXPLICIT JSON SCHEMA
          const result = await api.cv.analyzeResumes([], genPrompt, UPGRADE_PROMPT, text);
          
          if (result.json) {
              console.log("Upgrade successful, setting data:", result.json);
              setStructuredData(result.json);
              // Save immediately so next load is fast
              await api.cv.updateProfileContent(id, text, result.json);
          } else {
              console.warn("AI returned text but no JSON:", result);
          }
      } catch (e) {
          console.error("Failed to upgrade legacy profile:", e);
          alert("Auto-fill failed. Please try again or fill manually.");
      } finally {
          setIsUpgradingProfile(false);
      }
  };

  // --- UPDATED: Save Logic (Two-Way Sync) ---
  const handleSaveActiveProfile = async (updatedData: StructuredProfile) => {
      if (!activeProfileData) {
           alert("No active profile found. Please create one in 'Resume' tab first.");
           return;
      }
      
      // 1. Generate new Text representation from the updated JSON
      const newTextContent = generateProfileTextFromJSON(updatedData);

      // 2. Update DB with BOTH JSON and Text
      await api.cv.updateProfileContent(activeProfileData.id, newTextContent, updatedData);
      
      // 3. Update Local State
      setStructuredData(updatedData);
      setActiveProfileData(prev => prev ? { ...prev, content: newTextContent, structured_content: updatedData } : null);

      alert("Profile updated! The Legacy Text has been regenerated.");
  };

  // Load Prompts etc
  const loadPrompts = async () => { 
      const p = await api.settings.getAllPrompts(); 
      setAppPrompt(p.app || DEFAULT_APP_PROMPT);
      setGenPrompt(p.gen || DEFAULT_PROFILE_GEN_PROMPT);
      setAnalyzePrompt(p.analyze || DEFAULT_JOB_ANALYSIS_PROMPT);
  };
  const loadAnalysisLanguage = async () => {
      const s = await api.settings.getSettings();
      if (s && s.preferred_analysis_language) setAnalysisLang(s.preferred_analysis_language);
  };
  const loadSearchUrls = async () => { setIsLoadingUrls(true); setSearchUrls(await api.settings.getSearchUrls()); setIsLoadingUrls(false); };
  const loadAutomation = async () => {
      const settings = await api.settings.getSettings();
      if (settings) { setAutoEnabled(!!settings.is_auto_scan_enabled); setScanTime(settings.scan_time_utc || '15:00'); }
  };

  // --- File Handling ---
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => { 
      if (e.target.files) setFiles(Array.from(e.target.files)); 
  };
  
  const handleUploadAndAnalyze = async () => { 
      if (files.length === 0) return;
      setIsAnalyzing(true);
      setAnalysisStatus("Uploading files...");
      
      try {
          const paths = [];
          for (const file of files) {
              const path = await api.cv.uploadResume(file);
              if (path) paths.push(path);
          }
          
          if (paths.length > 0) {
              setAnalysisStatus(`Analyzing ${paths.length} document(s) with Azure OpenAI...`);
              const systemPrompt = genPrompt || DEFAULT_PROFILE_GEN_PROMPT;
              const result = await api.cv.analyzeResumes(paths, systemPrompt, "Generate comprehensive profile.");
              
              // Fallback if AI failed to return JSON
              const safeJson = result.json || createBlankProfile();

              const name = `Profile ${new Date().toLocaleDateString()} (${files.length} files)`;
              const fileNames = files.map(f => f.name);
              
              await api.cv.saveProfile(name, result.text, files.length, fileNames, safeJson);
              
              loadProfiles();
              setAnalysisStatus("Analysis Complete!");
              setFiles([]);
          } else {
              setAnalysisStatus("Failed to upload files.");
          }
      } catch (e: any) {
          setAnalysisStatus("Error: " + e.message);
      } finally {
          setIsAnalyzing(false);
      }
  };

  // --- Editor Modal Logic ---
  const openProfileEditor = (p: CVProfile) => {
      setEditingProfile(p);
      if (p.structured_content) {
          setParsedJson(p.structured_content);
      } else {
          // If opening a legacy profile in Resume Tab, just show text unless we upgrade
          setParsedJson(null); 
      }
  };

  const saveProfileChanges = async (updatedJson: StructuredProfile) => {
      if (!editingProfile) return;
      
      // Generate text sync
      const newText = generateProfileTextFromJSON(updatedJson);

      setParsedJson(updatedJson);
      await api.cv.updateProfileContent(editingProfile.id, newText, updatedJson);
      alert("Profile updated successfully!");
      loadProfiles();
  };

  // ... (Handlers) ...
  const handleSetActive = async (id: string) => { await api.cv.setProfileActive(id); loadProfiles(); };
  const handleDelete = async (id: string) => { await api.cv.deleteProfile(id); loadProfiles(); };
  
  const addUrl = (e?: React.FormEvent) => { 
      e?.preventDefault();
      if (newUrl) setSearchUrls([...searchUrls, newUrl]); 
      setNewUrl(''); 
  };
  
  const removeUrl = (i: number) => { const u = [...searchUrls]; u.splice(i, 1); setSearchUrls(u); };
  
  const saveUrls = async () => { 
      setIsSavingUrls(true); 
      try {
          await api.settings.saveSearchUrls(searchUrls); 
          alert(t('settings.search.save') + " Success!");
      } catch (error) {
          console.error(error);
          alert("Failed to save URLs");
      } finally {
          setIsSavingUrls(false); 
      }
  };

  const saveCurrentPrompt = async () => { 
      setIsSavingPrompts(true); 
      let success = false;
      if (activePromptTab === 'gen') success = await api.settings.savePrompts(undefined, genPrompt, undefined);
      if (activePromptTab === 'analyze') success = await api.settings.savePrompts(undefined, undefined, analyzePrompt);
      if (activePromptTab === 'app') success = await api.settings.savePrompts(appPrompt, undefined, undefined);
      await api.settings.saveAnalysisLanguage(analysisLang);
      setIsSavingPrompts(false); 
      if(success) alert("Saved!"); 
  };
  const saveAutomation = async () => { setIsSavingAuto(true); await api.settings.saveAutomation(autoEnabled, scanTime); setIsSavingAuto(false); alert("Saved!"); };
  const triggerManualScan = async () => {
      setScanLogs([]); setIsScanning(true); 
      setScanLogs(prev => [...prev, `Starting...`]);
      try {
          const res: any = await api.settings.triggerManualScan();
          setScanLogs(prev => [...prev, res.success ? `Success! Found ${res.jobsFound}` : `Failed: ${res.message}`]);
      } catch (error: any) { alert("Error: " + error.message); } 
      finally { setIsScanning(false); }
  };


  const renderTabs = () => (
    <div className="flex overflow-x-auto border-b border-slate-200 mb-6">
      {[
        { id: 'profile', label: t('settings.tabs.profile'), icon: User },
        { id: 'resume', label: t('settings.tabs.resume'), icon: Upload },
        { id: 'search', label: t('settings.tabs.search'), icon: Globe },
        { id: 'ai_config', label: t('settings.tabs.aiConfig'), icon: Bot },
        { id: 'automation', label: t('settings.tabs.automation'), icon: Zap },
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

        {/* --- PROFILE TAB (MAIN EDITOR) --- */}
        {activeTab === 'profile' && (
            <div className="animate-fade-in">
                {isLoadingActive ? <div className="flex justify-center py-20"><Loader2 className="animate-spin text-blue-600" size={32}/></div> : (
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                         {/* Left Column: The Editor */}
                         <div className="lg:col-span-2 relative">
                             {activeProfileData ? (
                                 isUpgradingProfile ? (
                                     <div className="absolute inset-0 z-20 bg-white/80 flex flex-col items-center justify-center rounded-xl backdrop-blur-sm border border-blue-100">
                                         <Loader2 size={40} className="animate-spin mb-4 text-blue-600"/>
                                         <p className="font-bold text-blue-800">AI is Parsing Profile...</p>
                                         <p className="text-sm text-blue-600">Reading Legacy Text and filling fields...</p>
                                     </div>
                                 ) : null
                             ) : null}

                             {activeProfileData ? (
                                 <ProfileEditor initialData={structuredData} onSave={handleSaveActiveProfile} />
                             ) : (
                                 <div className="bg-yellow-50 border border-yellow-200 p-6 rounded-xl text-center">
                                     <AlertCircle className="text-yellow-500 mx-auto mb-4" size={32}/>
                                     <h3 className="font-bold text-slate-800">No Active Profile</h3>
                                     <p className="text-sm text-slate-600 mb-4">You haven't selected an active profile yet. Please go to the <b>Resume Upload</b> tab, upload your CV, and set it as active.</p>
                                     <button onClick={() => setActiveTab('resume')} className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700">Go to Resume Upload</button>
                                 </div>
                             )}
                         </div>

                         {/* Right Column: Source Data */}
                         <div className="lg:col-span-1 space-y-6">
                            {/* Status Card */}
                            <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm sticky top-4">
                                <div className="flex items-center justify-between mb-3">
                                    <h3 className="font-bold text-slate-700 flex items-center gap-2"><StickyNote size={18}/> Legacy Text File</h3>
                                    {activeProfileData && (
                                        <button 
                                            onClick={() => handleUpgradeLegacyProfile(activeProfileData?.content || '', activeProfileData?.id)}
                                            disabled={isUpgradingProfile}
                                            className="text-[10px] bg-blue-50 text-blue-600 px-2 py-1 rounded border border-blue-100 hover:bg-blue-100 flex items-center gap-1 transition-colors"
                                            title="Force re-parse of text to editor"
                                        >
                                            <Wand2 size={10} className={isUpgradingProfile ? "animate-spin" : ""}/> Reset Editor from Text
                                        </button>
                                    )}
                                </div>
                                {activeProfileData ? (
                                    <>
                                        <div className="text-xs text-slate-500 mb-2">
                                            <b>Active Profile:</b> {activeProfileData.name}<br/>
                                            <b>Sync Status:</b> {isUpgradingProfile ? 'Syncing...' : <span className="text-green-600 font-bold">Synced</span>}
                                        </div>
                                        <div className="p-3 bg-blue-50 border border-blue-100 rounded text-xs text-blue-800 mb-4">
                                            ℹ️ This text is what the AI reads when applying for jobs. It updates automatically when you save the Editor.
                                        </div>
                                        <div className="border-t border-slate-100 pt-3">
                                             <div className="bg-slate-50 border border-slate-200 rounded p-2 text-[10px] text-slate-600 font-mono h-[500px] overflow-y-auto whitespace-pre-wrap">
                                                {activeProfileData.content}
                                             </div>
                                        </div>
                                    </>
                                ) : (
                                    <div className="text-sm text-slate-400 italic">Select an active profile to view source data.</div>
                                )}
                            </div>
                         </div>
                    </div>
                )}
            </div>
        )}

        {/* --- Resume Tab --- */}
        {activeTab === 'resume' && (
           <div className="space-y-8 animate-fade-in">
              {/* Upload Area */}
              <div className="border-2 border-dashed border-slate-300 rounded-xl p-8 text-center bg-slate-50 hover:bg-slate-100 transition-colors relative">
                 <input type="file" multiple accept=".pdf" onChange={handleFileChange} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" />
                 <div className="flex flex-col items-center gap-3">
                     <Upload size={32} className="text-blue-500" />
                     <p className="text-lg font-medium">{t('settings.resume.uploadTitle')}</p>
                     <p className="text-sm text-slate-500">{files.length > 0 ? `${files.length} file(s) selected` : 'Support multiple PDF files (max 10)'}</p>
                 </div>
              </div>
              <div className="flex justify-end gap-4 items-center">
                  {analysisStatus && <span className="text-sm text-slate-500 animate-pulse">{analysisStatus}</span>}
                  <button onClick={handleUploadAndAnalyze} disabled={isAnalyzing || files.length === 0} className={`bg-blue-600 text-white px-6 py-3 rounded-lg flex items-center gap-2 ${isAnalyzing ? 'opacity-50' : 'hover:bg-blue-700'}`}>
                    {isAnalyzing && <Loader2 className="animate-spin" />} {t('settings.resume.analyzeBtn')}
                  </button>
              </div>

              {/* Profile List */}
              <div className="mt-12 pt-8 border-t">
                 <h3 className="font-bold mb-4">{t('settings.resume.savedProfiles')}</h3>
                 {isLoadingProfiles ? <Loader2 className="animate-spin" /> : profiles.map(p => (
                    <div key={p.id} className={`p-4 mb-3 rounded-lg border flex justify-between items-center ${p.isActive ? 'bg-blue-50 border-blue-200' : 'bg-white hover:bg-slate-50'}`}>
                       <div className="flex items-center gap-3">
                           <div className={`p-2 rounded-full ${p.isActive ? 'bg-blue-100 text-blue-600' : 'bg-slate-100 text-slate-400'}`}><User size={20}/></div>
                           <div>
                               <div className="font-medium text-slate-900">{p.name} {p.isActive && <span className="bg-blue-200 text-blue-800 text-[10px] px-2 py-0.5 rounded-full ml-2 uppercase font-bold">{t('settings.resume.activeBadge')}</span>}</div>
                               <div className="text-xs text-slate-500">{new Date(p.createdAt).toLocaleDateString()} • {p.resumeCount} source(s)</div>
                           </div>
                       </div>
                       <div className="flex gap-2">
                          <button onClick={() => openProfileEditor(p)} className="text-xs border px-3 py-1.5 rounded bg-white hover:bg-slate-50 text-slate-600 flex items-center gap-1"><Eye size={14}/> {t('settings.resume.viewContent')}</button>
                          {!p.isActive && <button onClick={() => handleSetActive(p.id)} className="text-xs border px-3 py-1.5 rounded hover:bg-blue-50 text-blue-600 border-blue-200">{t('settings.resume.setActive')}</button>}
                          <button onClick={() => handleDelete(p.id)} className="text-red-400 hover:text-red-600 p-1.5"><Trash2 size={16} /></button>
                       </div>
                    </div>
                 ))}
              </div>
           </div>
        )}

        {/* --- EDITOR MODAL (For Resume Tab Viewing) --- */}
        {editingProfile && (
            <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
                <div className="bg-white rounded-xl w-full max-w-5xl max-h-[90vh] flex flex-col shadow-2xl animate-fade-in">
                    <div className="p-4 border-b flex justify-between items-center bg-slate-50 rounded-t-xl">
                        <div>
                            <h3 className="font-bold text-lg text-slate-800">{editingProfile.name}</h3>
                            <p className="text-xs text-slate-500">Structured Profile Editor</p>
                        </div>
                        <button onClick={() => setEditingProfile(null)} className="text-slate-400 hover:text-slate-700 p-2 hover:bg-slate-200 rounded-full"><X size={24} /></button>
                    </div>
                    
                    <div className="flex-1 overflow-y-auto bg-slate-100 p-4">
                        {parsedJson ? (
                            <ProfileEditor initialData={parsedJson} onSave={saveProfileChanges} />
                        ) : (
                            <div className="bg-white p-6 rounded-xl border border-yellow-200 text-center">
                                <AlertCircle size={40} className="text-yellow-500 mx-auto mb-4" />
                                <h4 className="font-bold text-slate-800 mb-2">Legacy Text Profile</h4>
                                <p className="text-sm text-slate-600 mb-4">This profile was generated before the Structured Data update. You can view the raw text, but editing is limited.</p>
                                <div className="bg-slate-50 p-4 rounded border font-mono text-xs text-left whitespace-pre-wrap max-h-[300px] overflow-y-auto mb-4">
                                    {editingProfile.content}
                                </div>
                                <button onClick={() => { setEditingProfile(null); setActiveTab('profile'); handleSetActive(editingProfile.id); }} className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 text-sm">
                                    Set Active & Upgrade to JSON
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        )}

        {/* --- Search Tab --- */}
        {activeTab === 'search' && (
           <div className="space-y-6 animate-fade-in">
              <div><h3 className="text-lg font-bold text-slate-800">{t('settings.search.title')}</h3></div>
              <form onSubmit={addUrl} className="flex gap-2">
                  <input value={newUrl} onChange={e => setNewUrl(e.target.value)} placeholder={t('settings.search.placeholder')} className="border p-2 rounded-lg flex-1 text-sm" />
                  <button type="submit" className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 font-medium">{t('settings.search.add')}</button>
              </form>
              <div className="bg-slate-50 rounded-lg border border-slate-200 divide-y divide-slate-200">
                {searchUrls.map((u, i) => (
                    <div key={i} className="flex justify-between p-3 items-center hover:bg-white transition-colors">
                        <div className="flex items-center gap-3 overflow-hidden"><span className="bg-slate-200 text-[10px] px-2 py-1 rounded font-bold">LINK</span> <span className="text-sm text-slate-600 truncate">{u}</span></div>
                        <button onClick={() => removeUrl(i)} className="text-slate-400 hover:text-red-500"><Trash2 size={14} /></button>
                    </div>
                ))}
              </div>
              <div className="flex justify-end">
                  <button 
                    type="button" 
                    onClick={saveUrls} 
                    disabled={isSavingUrls} 
                    className="bg-green-600 text-white px-6 py-2 rounded-lg hover:bg-green-700 flex items-center gap-2"
                  >
                    {isSavingUrls ? <Loader2 className="animate-spin" size={16} /> : <Save size={16} />}
                    {isSavingUrls ? 'Saving...' : t('settings.search.save')}
                  </button>
              </div>
           </div>
        )}

        {/* --- AI Config Tab --- */}
        {activeTab === 'ai_config' && (
           <div className="space-y-6 max-w-5xl animate-fade-in">
              <div className="flex justify-between items-center">
                  <div><h3 className="text-lg font-semibold text-slate-800 mb-1">{t('settings.aiConfig.title')}</h3><p className="text-slate-500 text-sm">{t('settings.aiConfig.subtitle')}</p></div>
                  <div className="flex bg-slate-100 p-1 rounded-lg">
                     {(['gen', 'analyze', 'app'] as const).map(tKey => (
                        <button key={tKey} onClick={() => setActivePromptTab(tKey)} className={`px-4 py-2 rounded-md text-xs font-bold transition-all ${activePromptTab === tKey ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>{tKey === 'gen' ? t('settings.aiConfig.genTab') : tKey === 'analyze' ? t('settings.aiConfig.analyzeTab') : t('settings.aiConfig.appTab')}</button>
                     ))}
                  </div>
              </div>
              <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4 flex items-center justify-between">
                  <div><h4 className="font-bold text-yellow-800 text-sm flex items-center gap-2"><Globe size={16}/> {t('settings.aiConfig.analysisLangTitle')}</h4><p className="text-xs text-yellow-700 mt-1">{t('settings.aiConfig.analysisLangDesc')}</p></div>
                  <select value={analysisLang} onChange={(e) => setAnalysisLang(e.target.value as Language)} className="border border-yellow-300 rounded px-3 py-1.5 text-sm"><option value="uk">Ukrainian</option><option value="no">Norwegian</option><option value="en">English</option></select>
              </div>
              {activePromptTab === 'gen' && <div className="space-y-2"><textarea value={genPrompt} onChange={(e) => setGenPrompt(e.target.value)} className="w-full h-[500px] p-4 text-sm border border-slate-200 rounded-lg font-mono" placeholder={DEFAULT_PROFILE_GEN_PROMPT} /></div>}
              {activePromptTab === 'analyze' && <div className="space-y-2"><textarea value={analyzePrompt} onChange={(e) => setAnalyzePrompt(e.target.value)} className="w-full h-[500px] p-4 text-sm border border-slate-200 rounded-lg font-mono" placeholder={DEFAULT_JOB_ANALYSIS_PROMPT} /></div>}
              {activePromptTab === 'app' && <div className="space-y-2"><textarea value={appPrompt} onChange={(e) => setAppPrompt(e.target.value)} className="w-full h-[500px] p-4 text-sm border border-slate-200 rounded-lg font-mono" placeholder={DEFAULT_APP_PROMPT} /></div>}
              <div className="flex justify-end pt-4 border-t"><button onClick={saveCurrentPrompt} disabled={isSavingPrompts} className="flex items-center gap-2 bg-blue-600 text-white px-6 py-3 rounded-lg hover:bg-blue-700 font-medium shadow-md">{isSavingPrompts ? <Loader2 className="animate-spin" /> : <Save size={18} />} {t('settings.aiConfig.savePrompt')}</button></div>
           </div>
        )}

        {/* --- Automation Tab --- */}
        {activeTab === 'automation' && (
           <div className="max-w-2xl space-y-8 animate-fade-in">
              <div className="bg-slate-900 text-white p-6 rounded-xl">
                  <h3 className="text-lg font-bold mb-4 flex items-center gap-2"><Bot/> {t('settings.automation.title')}</h3>
                  <div className="flex items-center justify-between bg-slate-800 p-4 rounded-lg mb-4"><span>{t('settings.automation.enable')}</span><input type="checkbox" checked={autoEnabled} onChange={e => setAutoEnabled(e.target.checked)} className="w-5 h-5" /></div>
                  <div className="flex items-center justify-between bg-slate-800 p-4 rounded-lg"><span><Clock size={18} className="inline mr-2"/> {t('settings.automation.runTime')}</span><input type="time" value={scanTime} onChange={e => setScanTime(e.target.value)} className="bg-slate-700 text-white p-2 rounded" /></div>
              </div>
              <div className="flex justify-between"><button onClick={triggerManualScan} disabled={isScanning} className="border p-2 rounded flex gap-2 items-center hover:bg-slate-50">{isScanning ? <Loader2 className="animate-spin"/> : <Play size={16}/>} {t('settings.automation.runTest')}</button><button onClick={saveAutomation} disabled={isSavingAuto} className="bg-blue-600 text-white px-6 py-2 rounded-lg">{isSavingAuto ? 'Saving...' : t('settings.automation.save')}</button></div>
              <div className="bg-slate-950 text-slate-300 p-4 rounded-lg font-mono text-xs h-[200px] overflow-y-auto border border-slate-800"><div className="border-b border-slate-800 pb-2 mb-2 text-slate-500">{t('settings.automation.debug')}</div>{scanLogs.length === 0 ? <i className="text-slate-600">Ready...</i> : scanLogs.map((l, i) => <div key={i}>{l}</div>)}</div>
           </div>
        )}
      </div>
    </div>
  );
};
