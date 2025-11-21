
export enum JobStatus {
  NEW = 'NEW',
  ANALYZED = 'ANALYZED',
  APPLIED = 'APPLIED',
  REJECTED = 'REJECTED',
  INTERVIEW = 'INTERVIEW',
  SENT = 'SENT'
}

export interface Job {
  id: string;
  title: string;
  company: string;
  location: string;
  url: string;
  source: 'FINN' | 'LINKEDIN' | 'NAV';
  postedDate: string;
  scannedAt: string;
  status: JobStatus;
  matchScore?: number;
  description?: string;
  ai_recommendation?: string; // Analysis text
  tasks_summary?: string; // NEW: Specific duties list
  application_id?: string; // Link to the generated application if exists
  cost_usd?: number; // NEW: Cost of analysis
}

export interface Application {
  id: string;
  job_id: string;
  user_id: string;
  cover_letter_no: string; // Norwegian version
  cover_letter_uk?: string; // Ukrainian translation (optional)
  status: 'draft' | 'approved' | 'sending' | 'manual_review' | 'sent' | 'failed' | 'rejected';
  created_at: string;
  approved_at?: string;
  sent_at?: string;
  skyvern_metadata?: {
    task_id?: string;
    url?: string;
    [key: string]: any;
  };
  cost_usd?: number; // NEW: Cost of generation
}

export interface ScanTask {
  id: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  type: string;
  createdAt: string;
}

export interface WorkerStatus {
  isOnline: boolean;
  lastSeen: string;
  currentTask?: string;
  cpuUsage: number;
  memoryUsage: number;
}

export interface DashboardStats {
  totalJobs: number;
  newJobsToday: number;
  applicationsSent: number;
  activeScans: number;
  totalCost: number; // NEW
}

export interface CVProfile {
  id: string;
  name: string;
  content: string; // The AI generated analysis
  isActive: boolean;
  createdAt: string;
  resumeCount: number;
}

export interface UserSettings {
  id: string;
  user_id: string;
  telegram_chat_id?: string;
  finn_search_urls: string[];
  application_prompt?: string;
  is_auto_scan_enabled?: boolean;
  scan_time_utc?: string; // Format "HH:MM"
}

export interface KnowledgeBaseItem {
  id: string;
  question: string;
  answer: string;
  category: string;
}

export interface AutomationSettings {
  is_auto_scan_enabled: boolean;
  scan_time_utc: string;
}
