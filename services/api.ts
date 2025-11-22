
import { supabase } from './supabase';
import { Job, JobStatus, DashboardStats, CVProfile, Application, UserSettings, KnowledgeBaseItem, SystemLog, AdminUser, RadarMetric, Aura, StructuredProfile } from '../types';
import { Language } from './translations';

// Helper to map database job to Job interface
const mapJob = (job: any): Job => ({
  id: job.id,
  title: job.title,
  company: job.company,
  location: job.location,
  url: job.job_url,
  source: job.source,
  postedDate: new Date(job.created_at).toLocaleDateString(),
  scannedAt: job.created_at,
  status: job.status as JobStatus,
  matchScore: job.relevance_score,
  description: job.description,
  ai_recommendation: job.ai_recommendation,
  tasks_summary: job.tasks_summary,
  application_id: job.application_id,
  cost_usd: job.cost_usd,
  aura: job.analysis_metadata?.aura,
  radarData: job.analysis_metadata?.radar ? [
      { subject: 'Tech Stack', A: job.analysis_metadata.radar.tech_stack || 0, fullMark: 100 },
      { subject: 'Soft Skills', A: job.analysis_metadata.radar.soft_skills || 0, fullMark: 100 },
      { subject: 'Culture', A: job.analysis_metadata.radar.culture || 0, fullMark: 100 },
      { subject: 'Salary', A: job.analysis_metadata.radar.salary_potential || 0, fullMark: 100 },
      { subject: 'Growth', A: job.analysis_metadata.radar.career_growth || 0, fullMark: 100 },
  ] : undefined
});

// --- HELPER: Generate Text from JSON for LLM Context ---
export const generateProfileTextFromJSON = (p: StructuredProfile): string => {
    if (!p) return "";
    
    const personal = p.personalInfo || { fullName: '', email: '', phone: '' };
    const work = p.workExperience || [];
    const edu = p.education || [];
    const tech = p.technicalSkills || {} as Partial<StructuredProfile['technicalSkills']>;
    const langs = p.languages || [];
    
    let text = `Legacy Text Profile\nGenerated from Structured Editor at ${new Date().toLocaleString()}\n\n`;
    
    text += `1) Summary\n${p.professionalSummary || 'No summary provided.'}\n\n`;
    
    text += `2) Core Competencies & Skills\n`;
    if (p.softSkills?.length) text += `- Soft Skills: ${p.softSkills.join(', ')}\n`;
    if (tech.programmingLanguages?.length) text += `- Languages: ${tech.programmingLanguages.join(', ')}\n`;
    if (tech.frameworks?.length) text += `- Frameworks: ${tech.frameworks.join(', ')}\n`;
    if (tech.aiTools?.length) text += `- AI Tools: ${tech.aiTools.join(', ')}\n`;
    if (tech.cloudPlatforms?.length) text += `- Cloud: ${tech.cloudPlatforms.join(', ')}\n`;
    if (tech.databases?.length) text += `- Databases: ${tech.databases.join(', ')}\n`;
    if (tech.developmentTools?.length) text += `- Tools: ${tech.developmentTools.join(', ')}\n`;
    text += '\n';

    text += `3) Experience Patterns\n`;
    work.forEach((w, index) => {
        text += `${String.fromCharCode(97 + index)}) ${w.position || 'Role'} at ${w.company || 'Company'}\n`;
        text += `   Period: ${w.startDate || ''} - ${w.endDate || ''}\n`;
        if (w.responsibilities?.length) {
             text += `   - ${w.responsibilities.join('\n   - ')}\n`;
        }
        text += '\n';
    });

    text += `4) Education & Certifications\n`;
    edu.forEach(e => {
        text += `- ${e.degree || ''} in ${e.field || ''} at ${e.institution || ''} (${e.graduationYear || ''})\n`;
    });
    if (p.certifications?.length) {
        text += `\nCertifications:\n- ${p.certifications.join('\n- ')}\n`;
    }
    text += '\n';

    text += `5) Additional Information\n`;
    text += `- Name: ${personal.fullName || ''}\n`;
    text += `- Contact: ${personal.email || ''} / ${personal.phone || ''}\n`;
    text += `- Location: ${personal.address?.city || ''}, ${personal.address?.country || ''}\n`;
    if (langs.length > 0) {
        text += `- Languages: ${langs.map(l => `${l.language} (${l.proficiencyLevel})`).join(', ')}\n`;
    }
    if (p.interests?.length) {
        text += `- Interests: ${p.interests.join(', ')}\n`;
    }

    return text;
};

export const api = {
  getJobs: async (): Promise<Job[]> => {
    const { data, error } = await supabase
      .from('jobs')
      .select('*')
      .order('created_at', { ascending: false });
    
    if (error) {
      console.error(error);
      return [];
    }
    return (data || []).map(mapJob);
  },

  getTotalCost: async (): Promise<number> => {
      const { data } = await supabase.from('system_logs').select('cost_usd');
      const total = (data || []).reduce((acc, curr) => acc + (curr.cost_usd || 0), 0);
      return total;
  },

  getSystemLogs: async (): Promise<SystemLog[]> => {
    const { data } = await supabase
      .from('system_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50);
    return data || [];
  },

  extractJobText: async (id: string, url: string) => {
    const { data, error } = await supabase.functions.invoke('extract_job_text', {
        body: { job_id: id, url }
    });
    if (error) return { success: false, message: error.message };
    return data;
  },

  analyzeJobs: async (jobIds: string[]) => {
     const { data: { user } } = await supabase.auth.getUser();
     const { data, error } = await supabase.functions.invoke('job-analyzer', {
         body: { jobIds, userId: user?.id }
     });
     if (error) return { success: false, message: error.message };
     return data;
  },

  getApplication: async (jobId: string): Promise<Application | null> => {
     const { data } = await supabase
        .from('applications')
        .select('*')
        .eq('job_id', jobId)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();
     return data;
  },

  generateApplication: async (jobId: string) => {
      const { data: { user } } = await supabase.auth.getUser();
      const { data, error } = await supabase.functions.invoke('generate_application', {
          body: { job_id: jobId, user_id: user?.id }
      });
      if (error) return { success: false, message: error.message };
      return data;
  },

  approveApplication: async (appId: string) => {
      const { error } = await supabase
          .from('applications')
          .update({ status: 'approved', approved_at: new Date().toISOString() })
          .eq('id', appId);
      return { success: !error, message: error?.message };
  },

  sendApplication: async (appId: string) => {
       const { error } = await supabase
          .from('applications')
          .update({ status: 'sending' })
          .eq('id', appId);
       return { success: !error, message: error?.message };
  },

  retrySend: async (appId: string) => {
      const { error } = await supabase
          .from('applications')
          .update({ status: 'approved' }) 
          .eq('id', appId);
      return { success: !error, message: error?.message };
  },

  cv: {
      verifyDatabaseConnection: async () => {
        const { error } = await supabase.from('cv_profiles').select('count').limit(1).single();
        return { success: !error, message: error ? error.message : 'Connected' };
      },
      getProfiles: async (): Promise<CVProfile[]> => {
        const { data } = await supabase.from('cv_profiles').select('*').order('created_at', { ascending: false });
        return (data || []).map((d: any) => ({
            id: d.id,
            name: d.profile_name,
            content: d.content,
            structured_content: d.structured_content,
            isActive: d.is_active,
            createdAt: d.created_at,
            resumeCount: d.source_file_count || 0,
            sourceFiles: d.source_files || []
        }));
    },
    getActiveProfile: async (): Promise<CVProfile | null> => {
        const { data, error } = await supabase
          .from('cv_profiles')
          .select('*')
          .eq('is_active', true)
          .limit(1)
          .single();
        
        if (error || !data) return null;
        
        return {
            id: data.id,
            name: data.profile_name,
            content: data.content,
            structured_content: data.structured_content,
            isActive: data.is_active,
            createdAt: data.created_at,
            resumeCount: data.source_file_count || 0,
            sourceFiles: data.source_files || []
        };
    },
    uploadResume: async (file: File): Promise<string | null> => {
        const fileName = `${Date.now()}_${file.name}`;
        const { data, error } = await supabase.storage.from('resumes').upload(fileName, file);
        if (error) return null;
        return data.path;
    },
    // Enhanced to support either File Paths or Raw Text (for upgrading legacy profiles)
    analyzeResumes: async (filePaths: string[], systemPrompt: string, userPrompt: string, rawText?: string): Promise<{text: string, json: StructuredProfile | null}> => {
         console.log("Sending analysis request...", { fileCount: filePaths.length, hasRawText: !!rawText });
         const { data, error } = await supabase.functions.invoke('analyze_profile', {
            body: { file_paths: filePaths, system_prompt: systemPrompt, user_prompt: userPrompt, raw_text: rawText }
         });
         if (error) {
            console.error("Analysis Failed:", error);
            throw error;
         }
         console.log("Analysis Response:", data);
         return { text: data.profileText, json: data.profileJSON };
    },
    saveProfile: async (name: string, content: string, count: number, files: string[], structuredContent?: StructuredProfile) => {
         const { data: { user } } = await supabase.auth.getUser();
         await supabase.from('cv_profiles').insert({
             profile_name: name, 
             content: content, 
             structured_content: structuredContent, 
             source_file_count: count, 
             source_files: files, 
             user_id: user?.id
         });
    },
    updateProfileContent: async (id: string, content: string, structuredContent: StructuredProfile) => {
        // We save BOTH the JSON and the generated Text
        await supabase.from('cv_profiles').update({ 
            content: content, 
            structured_content: structuredContent 
        }).eq('id', id);
    },
    setProfileActive: async (id: string) => {
        await supabase.from('cv_profiles').update({ is_active: false }).neq('id', '00000000-0000-0000-0000-000000000000');
        await supabase.from('cv_profiles').update({ is_active: true }).eq('id', id);
    },
    deleteProfile: async (id: string) => {
        await supabase.from('cv_profiles').delete().eq('id', id);
    }
  },

  settings: {
      getSettings: async (): Promise<UserSettings | null> => {
           const { data: { user } } = await supabase.auth.getUser();
           if (!user) return null;
           const { data } = await supabase.from('user_settings').select('*').eq('user_id', user.id).single();
           return data;
      },
      getSearchUrls: async (): Promise<string[]> => {
          const s = await api.settings.getSettings();
          return s?.finn_search_urls || [];
      },
      saveSearchUrls: async (urls: string[]) => {
          const { data: { user } } = await supabase.auth.getUser();
          if (!user) throw new Error("No user logged in");
          const { error } = await supabase.from('user_settings').upsert({ user_id: user.id, finn_search_urls: urls });
          if (error) throw error;
      },
      getAllPrompts: async () => {
          const s = await api.settings.getSettings();
          return {
              app: s?.application_prompt,
              gen: s?.profile_gen_prompt,
              analyze: s?.job_analysis_prompt
          };
      },
      savePrompts: async (app?: string, gen?: string, analyze?: string) => {
          const { data: { user } } = await supabase.auth.getUser();
          if (!user) return false;
          const update: any = { user_id: user.id };
          if (app !== undefined) update.application_prompt = app;
          if (gen !== undefined) update.profile_gen_prompt = gen;
          if (analyze !== undefined) update.job_analysis_prompt = analyze;
          const { error } = await supabase.from('user_settings').upsert(update);
          return !error;
      },
      saveAnalysisLanguage: async (lang: Language) => {
          const { data: { user } } = await supabase.auth.getUser();
          if (!user) return;
          await supabase.from('user_settings').upsert({ user_id: user.id, preferred_analysis_language: lang });
      },
      saveLanguage: async (lang: Language) => {
          const { data: { user } } = await supabase.auth.getUser();
          if (!user) return;
          await supabase.from('user_settings').upsert({ user_id: user.id, ui_language: lang });
      },
      saveAutomation: async (enabled: boolean, time: string) => {
          const { data: { user } } = await supabase.auth.getUser();
          if (!user) return;
          await supabase.from('user_settings').upsert({ 
              user_id: user.id, 
              is_auto_scan_enabled: enabled,
              scan_time_utc: time
          });
      },
      triggerManualScan: async () => {
          const { data: { user } } = await supabase.auth.getUser();
          const { data, error } = await supabase.functions.invoke('scheduled-scanner', {
              body: { forceRun: true, source: 'WEB_MANUAL' }
          });
          if (error) throw error;
          return data;
      },
      getKnowledgeBase: async (): Promise<KnowledgeBaseItem[]> => {
          // FIXED: Table name was incorrect (404 error)
          const { data } = await supabase.from('user_knowledge_base').select('*');
          return data || [];
      },
      addKnowledgeBaseItem: async (q: string, a: string, c: string) => {
           await supabase.from('user_knowledge_base').insert({ question: q, answer: a, category: c });
      },
      deleteKnowledgeBaseItem: async (id: string) => {
           await supabase.from('user_knowledge_base').delete().eq('id', id);
      }
  },

  admin: {
      listUsers: async () => {
           const { data, error } = await supabase.functions.invoke('admin-actions', {
               body: { action: 'list_users' }
           });
           if (error) return { success: false, error: error.message };
           return data;
      },
      createUser: async (email: string, password: string, role: string) => {
           const { data, error } = await supabase.functions.invoke('admin-actions', {
               body: { action: 'create_user', email, password, role }
           });
           if (error) return { success: false, error: error.message };
           return data;
      },
      deleteUser: async (userId: string) => {
           const { data, error } = await supabase.functions.invoke('admin-actions', {
               body: { action: 'delete_user', userId }
           });
           if (error) return { success: false, error: error.message };
           return data;
      }
  }
};

export const { 
    getJobs, getTotalCost, getSystemLogs, extractJobText, analyzeJobs, 
    getApplication, generateApplication, approveApplication, sendApplication, retrySend, 
    settings, admin, cv 
} = api;
