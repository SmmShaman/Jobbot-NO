import { Job, JobStatus, WorkerStatus, DashboardStats } from '../types';

export const MOCK_STATS: DashboardStats = {
  totalJobs: 124,
  newJobsToday: 12,
  applicationsSent: 45,
  activeScans: 1,
  totalCost: 12.50,
};

export const MOCK_WORKER_STATUS: WorkerStatus = {
  isOnline: true,
  lastSeen: 'Just now',
  currentTask: 'Scanning FINN.no for "Frontend Developer"',
  cpuUsage: 24,
  memoryUsage: 45,
};

export const MOCK_JOBS: Job[] = [
  {
    id: '1',
    title: 'Senior React Developer',
    company: 'TechNordic AS',
    location: 'Oslo, Norway',
    url: '#',
    source: 'FINN',
    postedDate: '2023-10-25',
    scannedAt: '2023-10-26T10:00:00Z',
    status: JobStatus.ANALYZED,
    matchScore: 92,
  },
  {
    id: '2',
    title: 'Fullstack Engineer (Python/React)',
    company: 'Innovation Norway',
    location: 'Bergen, Norway',
    url: '#',
    source: 'LINKEDIN',
    postedDate: '2023-10-24',
    scannedAt: '2023-10-26T09:30:00Z',
    status: JobStatus.NEW,
    matchScore: 85,
  },
  {
    id: '3',
    title: 'Frontend Lead',
    company: 'Vipps MobilePay',
    location: 'Oslo, Norway',
    url: '#',
    source: 'FINN',
    postedDate: '2023-10-23',
    scannedAt: '2023-10-25T14:20:00Z',
    status: JobStatus.APPLIED,
    matchScore: 98,
  },
  {
    id: '4',
    title: 'Junior Web Developer',
    company: 'StartupLab',
    location: 'Remote (Norway)',
    url: '#',
    source: 'NAV',
    postedDate: '2023-10-26',
    scannedAt: '2023-10-26T11:15:00Z',
    status: JobStatus.NEW,
    matchScore: 45,
  },
  {
    id: '5',
    title: 'Software Engineer',
    company: 'Equinor',
    location: 'Stavanger, Norway',
    url: '#',
    source: 'LINKEDIN',
    postedDate: '2023-10-20',
    scannedAt: '2023-10-21T09:00:00Z',
    status: JobStatus.REJECTED,
    matchScore: 76,
  },
];

export const CHART_DATA = [
  { name: 'Mon', jobs: 4 },
  { name: 'Tue', jobs: 12 },
  { name: 'Wed', jobs: 8 },
  { name: 'Thu', jobs: 24 },
  { name: 'Fri', jobs: 16 },
  { name: 'Sat', jobs: 5 },
  { name: 'Sun', jobs: 2 },
];