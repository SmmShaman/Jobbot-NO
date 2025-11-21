
import { supabase } from './supabase';
import { Job, JobStatus, DashboardStats, CVProfile, Application, UserSettings, KnowledgeBaseItem } from '../types';

// Helper to map DB job to Frontend Job interface
const mapJob = (data: any): Job => {
  // Safety check: Ensure ai_recommendation is a string.
  let aiAnalysis = data.ai_recommendation;
  if (aiAnalysis && typeof aiAnalysis === 'object') {
    if (aiAnalysis.analysis) {
        aiAnalysis = aiAnalysis.analysis;
    } else {
        aiAnalysis = JSON.stringify(aiAnalysis, null, 2);
    }
  }

  return {
    id: data.id,
    title: data.title,
    company: data.company,
    location: data.location,
    url: data.job_url, 
    source: data.source,
    postedDate: data.posted_date || (data.created_at ? data.created_at.split('T')[0] : ''),
    scannedAt: data.created_at,
    status: (data.status as JobStatus) || JobStatus.NEW,
    matchScore: data.relevance_score ?? data.match_score, 
    description: data.description,
    ai_recommendation: aiAnalysis,
    tasks_summary: data.tasks_summary, // NEW MAPPING
    application_id: data.applications?.[0]?.id, // If array has items, app exists
    cost_usd: data.cost_usd || 0
  };
};

export const api = {
  getJobs: async (): Promise<Job[]> => {
    try {
      // CHANGED: Removed explicit 'cost_usd' from applications join to prevent errors if column missing.
      // We select 'applications(id)' to check existence.
      const { data, error } = await supabase
        .from('jobs')
        .select('*, applications(id)')
        .order('created_at', { ascending: false });

      if (error) {
        console.error('Error fetching jobs:', JSON.stringify(error, null, 2));
        return [];
      }

      return (data || []).map((row: any) => ({
        ...mapJob(row),
        application_id: row.applications?.[0]?.id
      }));
    } catch (e: any) {
      console.error('Unexpected error fetching jobs:', e.message || e);
      return [];
    }
  },
  
  // Added method to fetch total cost including applications
  getTotalCost: async (): Promise<number> => {
      try {
          // Safe fetch: separate try/catches in case columns don't exist yet
          let jobsCost = 0;
          let appsCost = 0;

          try {
            const { data: jobs } = await supabase.from('jobs').select('cost_usd');
            jobsCost = (jobs || []).reduce((sum, j) => sum + (j.cost_usd || 0), 0);
          } catch (e) { console.warn("Cost column missing on jobs"); }

          try {
            const { data: apps } = await supabase.from('applications').select('cost_usd');
            appsCost = (apps || []).reduce((sum, a) => sum + (a.cost_usd || 0), 0);
          } catch (e) { console.warn("Cost column missing on applications"); }
          
          return jobsCost + appsCost;
      } catch (e) { return 0; }
  },

  extractJobText: async (jobId: string, jobUrl: string): Promise<{ success: boolean; text?: string; error?: string }> => {
    try {
      const { data: localData } = await supabase
        .from('jobs')
        .select('description')
        .eq('id', jobId)
        .single();
      
      if (localData?.description && localData.description.length > 50) {
        return { success: true, text: localData.description };
      }

      const { data, error } = await supabase.functions.invoke('extract_job_text', {
        body: { job_id: jobId, url: jobUrl }
      });

      if (error) throw error;
      return { success: true, text: data.text };

    } catch (e: any) {
      console.error('Error extracting job text:', e);
      return { success: false, error: e.message };
    }
  },

  analyzeJobs: async (jobIds: string[]): Promise<{ success: boolean; message?: string }> => {
    try {
      const { data: settings } = await supabase.from('user_settings').select('user_id').limit(1).single();
      const userId = settings?.user_id;
      
      const { error } = await supabase.functions.invoke('job-analyzer', {
        body: { jobIds, userId }
      });

      if (error) throw error;
      return { success: true };
    } catch (e: any) {
      console.error('Error analyzing jobs:', e);
      return { success: false, message: e.message };
    }
  },

  // --- APPLICATION METHODS ---

  // Get existing application for a job
  getApplication: async (jobId: string): Promise<Application | null> => {
    try {
      const { data, error } = await supabase
        .from('applications')
        .select('*')
        .eq('job_id', jobId)
        .limit(1)
        .single();
      
      if (error) return null;
      return data as Application;
    } catch (e) { return null; }
  },

  generateApplication: async (jobId: string): Promise<{ success: boolean; application?: Application; message?: string }> => {
    try {
      const { data: settings } = await supabase.from('user_settings').select('user_id').limit(1).single();
      const userId = settings?.user_id;

      const { data, error } = await supabase.functions.invoke('generate_application', {
        body: { job_id: jobId, user_id: userId }
      });

      if (error || !data.success) {
         return { success: false, message: error?.message || data?.message || "Unknown error" };
      }
      return { success: true, application: data.application };
    } catch (e: any) {
      return { success: false, message: e.message };
    }
  },

  approveApplication: async (appId: string): Promise<{ success: boolean; message?: string }> => {
    try {
      const { error } = await supabase
        .from('applications')
        .update({ status: 'approved', approved_at: new Date().toISOString() })
        .eq('id', appId);
      
      if (error) throw error;
      return { success: true };
    } catch (e: any) {
      return { success: false, message: e.message };
    }
  },

  sendApplication: async (appId: string): Promise<{ success: boolean; message?: string }> => {
    try {
      const { error } = await supabase
        .from('applications')
        .update({ status: 'sending' })
        .eq('id', appId);
      
      if (error) throw error;
      return { success: true };
    } catch (e: any) {
      return { success: false, message: e.message };
    }
  },

  retrySend: async (appId: string): Promise<{ success: boolean; message?: string }> => {
     try {
      const { error } = await supabase
        .from('applications')
        .update({ status: 'approved' }) 
        .eq('id', appId);
      
      if (error) throw error;
      return { success: true };
    } catch (e: any) {
      return { success: false, message: e.message };
    }
  },

  // --- CV & PROFILES ---
  cv: {
    verifyDatabaseConnection: async (): Promise<{ success: boolean; message: string }> => {
      try {
        const { count, error } = await supabase.from('jobs').select('*', { count: 'exact', head: true });
        if (error) throw error;
        return { success: true, message: `Connected. Found ${count} jobs.` };
      } catch (e: any) {
        return { success: false, message: e.message };
      }
    },
    getProfiles: async (): Promise<CVProfile[]> => {
        const { data } = await supabase.from('cv_profiles').select('*').order('created_at', { ascending: false });
        return (data || []).map((d: any) => ({
            id: d.id,
            name: d.profile_name,
            content: d.content,
            isActive: d.is_active,
            createdAt: d.created_at,
            resumeCount: d.source_file_count || 0
        }));
    },
    uploadResume: async (file: File): Promise<string | null> => {
        const fileName = `${Date.now()}_${file.name}`;
        const { data, error } = await supabase.storage.from('resumes').upload(fileName, file);
        if (error) {
            console.error("Upload error", error);
            return null;
        }
        return data.path;
    },
    analyzeResumes: async (filePaths: string[], systemPrompt: string, userPrompt: string): Promise<string> => {
         const { data, error } = await supabase.functions.invoke('analyze_profile', {
            body: { file_paths: filePaths, system_prompt: systemPrompt, user_prompt: userPrompt }
         });
         if (error) throw error;
         return data.profile;
    },
    saveProfile: async (name: string, content: string, count: number) => {
         await supabase.from('cv_profiles').insert({
             profile_name: name,
             content: content,
             source_file_count: count
         });
    },
    setProfileActive: async (id: string) => {
        await supabase.from('cv_profiles').update({ is_active: false }).neq('id', '00000000-0000-0000-0000-000000000000');
        await supabase.from('cv_profiles').update({ is_active: true }).eq('id', id);
    },
    deleteProfile: async (id: string) => {
        await supabase.from('cv_profiles').delete().eq('id', id);
    }
  },

  // --- SETTINGS ---
  settings: {
    getSearchUrls: async (): Promise<string[]> => {
        const { data } = await supabase.from('user_settings').select('finn_search_urls').limit(1).single();
        return data?.finn_search_urls || [];
    },
    saveSearchUrls: async (urls: string[]) => {
        const { data } = await supabase.from('user_settings').select('id').limit(1).single();
        if (data) {
             await supabase.from('user_settings').update({ finn_search_urls: urls }).eq('id', data.id);
        }
    },
    getApplicationPrompt: async (): Promise<string | null> => {
        const { data } = await supabase.from('user_settings').select('application_prompt').limit(1).single();
        return data?.application_prompt || null;
    },
    saveApplicationPrompt: async (prompt: string): Promise<boolean> => {
         const { data } = await supabase.from('user_settings').select('id').limit(1).single();
         if (data) {
             const { error } = await supabase.from('user_settings').update({ application_prompt: prompt }).eq('id', data.id);
             return !error;
         }
         return false;
    },
    getSettings: async (): Promise<UserSettings | null> => {
        const { data } = await supabase.from('user_settings').select('*').limit(1).single();
        return data as UserSettings;
    },
    saveAutomation: async (enabled: boolean, time: string) => {
         const { data } = await supabase.from('user_settings').select('id').limit(1).single();
         if (data) {
             await supabase.from('user_settings').update({ is_auto_scan_enabled: enabled, scan_time_utc: time }).eq('id', data.id);
         }
    },
    triggerManualScan: async () => {
        const { data, error } = await supabase.functions.invoke('scheduled-scanner', {
             body: { forceRun: true }
        });
        if (error) return { success: false, message: error.message };
        return data;
    },
    getKnowledgeBase: async (): Promise<KnowledgeBaseItem[]> => {
        const { data } = await supabase.from('knowledge_base').select('*');
        return (data || []) as KnowledgeBaseItem[];
    },
    addKnowledgeBaseItem: async (q: string, a: string, cat: string) => {
        const { data: u } = await supabase.from('user_settings').select('user_id').limit(1).single();
        await supabase.from('knowledge_base').insert({
            user_id: u?.user_id,
            question: q,
            answer: a,
            category: cat
        });
    },
    deleteKnowledgeBaseItem: async (id: string) => {
        await supabase.from('knowledge_base').delete().eq('id', id);
    }
  }
};
