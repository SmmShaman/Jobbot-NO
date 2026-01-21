
import React, { useState, useEffect, useCallback } from 'react';
import { JobTable } from '../components/JobTable';
import { api } from '../services/api';
import { Job, ExportHistory } from '../types';
import { Download, Loader2, RefreshCw, Clock, Calendar, FileSpreadsheet, FileText, History, X, Trash2 } from 'lucide-react';
import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

interface ScanScheduleInfo {
  enabled: boolean;
  timeUtc: string;
  nextScanIn: string;
  nextScanDate: string;
}

const calculateNextScan = (scanTimeUtc: string): { nextScanIn: string; nextScanDate: string } => {
  if (!scanTimeUtc) return { nextScanIn: 'Not scheduled', nextScanDate: '' };

  const [hours, minutes] = scanTimeUtc.split(':').map(Number);
  const now = new Date();
  const nowUtc = new Date(now.toISOString());

  // Create next scan time in UTC
  let nextScan = new Date(Date.UTC(
    nowUtc.getUTCFullYear(),
    nowUtc.getUTCMonth(),
    nowUtc.getUTCDate(),
    hours,
    minutes,
    0
  ));

  // If scan time already passed today, schedule for tomorrow
  if (nextScan <= nowUtc) {
    nextScan.setUTCDate(nextScan.getUTCDate() + 1);
  }

  const diffMs = nextScan.getTime() - nowUtc.getTime();
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffMinutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));

  // Convert to Norway time (UTC+1 or UTC+2 for DST)
  const norwayTime = new Date(nextScan.getTime());
  const norwayTimeStr = norwayTime.toLocaleTimeString('no-NO', {
    timeZone: 'Europe/Oslo',
    hour: '2-digit',
    minute: '2-digit'
  });

  let nextScanIn = '';
  if (diffHours > 0) {
    nextScanIn = `${diffHours} год ${diffMinutes} хв`;
  } else {
    nextScanIn = `${diffMinutes} хв`;
  }

  return {
    nextScanIn,
    nextScanDate: `${norwayTimeStr} (Norway)`
  };
};

interface JobsPageProps {
  setSidebarCollapsed?: (collapsed: boolean) => void;
}

export const JobsPage: React.FC<JobsPageProps> = ({ setSidebarCollapsed }) => {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [scanSchedule, setScanSchedule] = useState<ScanScheduleInfo | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [exportHistory, setExportHistory] = useState<ExportHistory[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  // Fetch export history
  const fetchExportHistory = async () => {
    setLoadingHistory(true);
    const history = await api.exports.getExportHistory();
    setExportHistory(history);
    setLoadingHistory(false);
  };

  // Export all jobs to Excel or PDF and save to Supabase
  const handleExport = async (format: 'xlsx' | 'pdf') => {
    if (jobs.length === 0) return;

    const dateStr = new Date().toISOString().split('T')[0];
    const timeStr = new Date().toISOString().split('T')[1].slice(0, 5).replace(':', '-');
    const filename = `vakansii_${dateStr}_${timeStr}.${format}`;
    const mimeType = format === 'xlsx'
      ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      : 'application/pdf';

    // 1. FIRST show the save dialog (while user gesture is still active!)
    let fileHandle: any = null;

    if ('showSaveFilePicker' in window) {
      try {
        fileHandle = await (window as any).showSaveFilePicker({
          suggestedName: filename,
          types: [{
            description: format === 'xlsx' ? 'Excel Spreadsheet' : 'PDF Document',
            accept: { [mimeType]: [`.${format}`] }
          }]
        });
      } catch (err: any) {
        if (err.name === 'AbortError') return; // User cancelled
        console.error('Save dialog error:', err);
        fileHandle = null; // Fallback to standard download
      }
    }

    // 2. THEN show loading and generate blob
    setIsExporting(true);

    try {
      const exportData = jobs.map(job => ({
        'Назва': job.title,
        'Компанія': job.company,
        'Локація': job.location,
        'Джерело': job.source,
        'Релевантність': job.matchScore ? `${job.matchScore}%` : '-',
        'Статус': job.status,
        'Дедлайн': job.deadline || '-',
        'URL': job.url,
        'Søknad статус': job.application_status || '-'
      }));

      let blob: Blob;

      if (format === 'xlsx') {
        const ws = XLSX.utils.json_to_sheet(exportData);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Вакансії');
        const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
        blob = new Blob([wbout], { type: mimeType });
      } else {
        // PDF з альбомною орієнтацією
        const doc = new jsPDF({ orientation: 'landscape' });

        // Document header (English - jsPDF doesn't support Cyrillic)
        doc.setFontSize(16);
        doc.setFont('helvetica', 'bold');
        doc.text('Jobs - JobBot Norway', 14, 15);
        doc.setFontSize(10);
        doc.setFont('helvetica', 'normal');
        doc.text(`Exported: ${new Date().toLocaleDateString('en-GB')} | Total: ${jobs.length} jobs`, 14, 22);

        // Truncate URL for readability
        const truncateUrl = (url: string, max = 40) =>
          url.length > max ? url.substring(0, max) + '...' : url;

        autoTable(doc, {
          head: [['Title', 'Company', 'Location', 'Source', 'Match', 'Status', 'Deadline', 'URL', 'Applied']],
          body: exportData.map(row => [
            row['Назва'],
            row['Компанія'],
            row['Локація'],
            row['Джерело'],
            row['Релевантність'],
            row['Статус'],
            row['Дедлайн'],
            truncateUrl(row['URL']),
            row['Søknad статус']
          ]),
          startY: 28,
          styles: {
            fontSize: 7,
            cellPadding: 3,
            overflow: 'linebreak',
            valign: 'middle'
          },
          headStyles: {
            fillColor: [59, 130, 246],  // blue-500
            textColor: 255,
            fontStyle: 'bold',
            halign: 'center'
          },
          alternateRowStyles: {
            fillColor: [248, 250, 252]  // slate-50
          },
          columnStyles: {
            0: { cellWidth: 50 },  // Назва
            1: { cellWidth: 35 },  // Компанія
            2: { cellWidth: 25 },  // Локація
            3: { cellWidth: 18, halign: 'center' },  // Джерело
            4: { cellWidth: 18, halign: 'center' },  // Релевантність
            5: { cellWidth: 22, halign: 'center' },  // Статус
            6: { cellWidth: 22, halign: 'center' },  // Дедлайн
            7: { cellWidth: 55 },  // URL
            8: { cellWidth: 20, halign: 'center' }   // Søknad
          },
          margin: { left: 10, right: 10 }
        });

        blob = doc.output('blob');
      }

      // 3. Save file
      if (fileHandle) {
        const writable = await fileHandle.createWritable();
        await writable.write(blob);
        await writable.close();
      } else {
        // Fallback: standard download
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
      }

      // 4. Save to Supabase Storage for history
      const result = await api.exports.saveExport(blob, filename, format, jobs.length);
      if (!result.success) {
        console.error('Failed to save export to cloud:', result.error);
      }

      // Refresh history if modal is open
      if (showHistory) {
        fetchExportHistory();
      }
    } catch (err) {
      console.error('Export error:', err);
      alert('Помилка експорту. Перевірте консоль.');
    } finally {
      setIsExporting(false);
    }
  };

  // Delete export from history
  const handleDeleteExport = async (exp: ExportHistory) => {
    if (!confirm(`Видалити "${exp.filename}"?`)) return;
    const success = await api.exports.deleteExport(exp.id, exp.file_path);
    if (success) {
      setExportHistory(prev => prev.filter(e => e.id !== exp.id));
    }
  };

  // Download export from history
  const handleDownloadExport = async (exp: ExportHistory) => {
    if (exp.download_url) {
      window.open(exp.download_url, '_blank');
    } else {
      const url = await api.exports.getDownloadUrl(exp.file_path);
      if (url) {
        window.open(url, '_blank');
      }
    }
  };

  // Format file size
  const formatSize = (bytes?: number) => {
    if (!bytes) return '-';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  // Fetch scan schedule settings
  useEffect(() => {
    const fetchScanSchedule = async () => {
      try {
        const settings = await api.settings.getSettings();
        if (settings) {
          const { nextScanIn, nextScanDate } = calculateNextScan(settings.scan_time_utc || '09:00');
          setScanSchedule({
            enabled: settings.is_auto_scan_enabled || false,
            timeUtc: settings.scan_time_utc || '09:00',
            nextScanIn,
            nextScanDate
          });
        }
      } catch (e) {
        console.error("Failed to fetch scan schedule:", e);
      }
    };
    fetchScanSchedule();

    // Update countdown every minute
    const interval = setInterval(() => {
      if (scanSchedule?.timeUtc) {
        const { nextScanIn, nextScanDate } = calculateNextScan(scanSchedule.timeUtc);
        setScanSchedule(prev => prev ? { ...prev, nextScanIn, nextScanDate } : null);
      }
    }, 60000);

    return () => clearInterval(interval);
  }, []);

  // isBackgroundUpdate param ensures we don't show the full-screen loader on auto-refresh
  const fetchJobs = useCallback(async (isBackgroundUpdate = false) => {
    try {
        if (!isBackgroundUpdate) setLoading(true);
        console.log("JobsPage: Fetching jobs from API...");

        const data = await api.getJobs();
        console.log("JobsPage: Received jobs:", data.length);

        // Critical Fix: Only update state if data is a valid array.
        // We do NOT clear the state on error to prevent flickering or disappearance.
        if (Array.isArray(data)) {
             setJobs(data);
        } else {
             console.error("JobsPage: Invalid data format received", data);
        }
    } catch (err) {
        console.error("JobsPage: Fetch error", err);
    } finally {
        if (!isBackgroundUpdate) setLoading(false);
    }
  }, []);

  // Initial load + Realtime Subscription
  useEffect(() => {
    fetchJobs();

    // Subscribe to DB changes (Telegram Bot, etc.)
    const unsubscribe = api.subscribeToChanges(() => {
        console.log("JobsPage: Realtime update detected. Refreshing list...");
        fetchJobs(true); // background update
    });

    return () => {
        unsubscribe();
    };
  }, [fetchJobs]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            Jobs Market
            <span className="flex h-2 w-2 relative">
               <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
               <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500"></span>
            </span>
          </h2>
          <p className="text-slate-500">Manage and track your opportunities.</p>

          {/* Scan Schedule Info */}
          {scanSchedule && (
            <div className={`mt-2 flex items-center gap-3 text-xs ${scanSchedule.enabled ? 'text-green-600' : 'text-slate-400'}`}>
              <div className="flex items-center gap-1">
                <Clock size={12} />
                <span>
                  {scanSchedule.enabled ? (
                    <>Сканування щодня о <b>{scanSchedule.nextScanDate}</b></>
                  ) : (
                    'Автосканування вимкнено'
                  )}
                </span>
              </div>
              {scanSchedule.enabled && (
                <div className="flex items-center gap-1 bg-green-50 px-2 py-0.5 rounded-full border border-green-200">
                  <Calendar size={12} />
                  <span>Наступне через <b>{scanSchedule.nextScanIn}</b></span>
                </div>
              )}
            </div>
          )}
        </div>
        <div className="flex gap-3">
          <button
            onClick={() => fetchJobs(false)}
            className="flex items-center gap-2 text-slate-600 bg-white border border-slate-300 px-4 py-2 rounded-lg hover:bg-slate-50 text-sm font-medium"
          >
            <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
            Refresh
          </button>
          <button
            onClick={() => handleExport('xlsx')}
            disabled={isExporting || jobs.length === 0}
            className="flex items-center gap-2 text-white bg-emerald-600 px-4 py-2 rounded-lg hover:bg-emerald-700 text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isExporting ? <Loader2 size={16} className="animate-spin" /> : <FileSpreadsheet size={16} />}
            Excel
          </button>
          <button
            onClick={() => handleExport('pdf')}
            disabled={isExporting || jobs.length === 0}
            className="flex items-center gap-2 text-white bg-red-600 px-4 py-2 rounded-lg hover:bg-red-700 text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isExporting ? <Loader2 size={16} className="animate-spin" /> : <FileText size={16} />}
            PDF
          </button>
          <button
            onClick={() => { setShowHistory(true); fetchExportHistory(); }}
            className="flex items-center gap-2 text-slate-600 bg-white border border-slate-300 px-4 py-2 rounded-lg hover:bg-slate-50 text-sm font-medium"
            title="Історія експортів"
          >
            <History size={16} />
          </button>
        </div>
      </div>

      {/* Export History Modal */}
      {showHistory && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowHistory(false)}>
          <div className="bg-white rounded-xl shadow-xl max-w-2xl w-full mx-4 max-h-[80vh] overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b">
              <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                <History size={20} /> Історія експортів
              </h3>
              <button onClick={() => setShowHistory(false)} className="text-slate-400 hover:text-slate-600">
                <X size={20} />
              </button>
            </div>
            <div className="p-4 overflow-y-auto max-h-[60vh]">
              {loadingHistory ? (
                <div className="flex justify-center py-8">
                  <Loader2 size={24} className="animate-spin text-blue-600" />
                </div>
              ) : exportHistory.length === 0 ? (
                <div className="text-center py-8 text-slate-400">
                  <History size={48} className="mx-auto mb-2 opacity-50" />
                  <p>Немає збережених експортів</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {exportHistory.map(exp => (
                    <div key={exp.id} className="flex items-center justify-between p-3 bg-slate-50 rounded-lg hover:bg-slate-100 transition-colors">
                      <div className="flex items-center gap-3">
                        {exp.format === 'xlsx' ? (
                          <FileSpreadsheet size={24} className="text-emerald-600" />
                        ) : (
                          <FileText size={24} className="text-red-600" />
                        )}
                        <div>
                          <p className="font-medium text-slate-900 text-sm">{exp.filename}</p>
                          <p className="text-xs text-slate-500">
                            {new Date(exp.created_at).toLocaleString('uk-UA')} • {exp.jobs_count} вакансій • {formatSize(exp.file_size)}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => handleDownloadExport(exp)}
                          className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                          title="Завантажити"
                        >
                          <Download size={18} />
                        </button>
                        <button
                          onClick={() => handleDeleteExport(exp)}
                          className="p-2 text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                          title="Видалити"
                        >
                          <Trash2 size={18} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {loading && jobs.length === 0 ? (
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
             <button onClick={() => fetchJobs(false)} className="mt-4 text-blue-600 hover:underline text-sm">Try refreshing again</button>
           </div>
        </div>
      ) : (
        <JobTable jobs={jobs} onRefresh={() => fetchJobs(true)} setSidebarCollapsed={setSidebarCollapsed} />
      )}
    </div>
  );
};
