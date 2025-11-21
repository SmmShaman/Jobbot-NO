
import React, { useEffect, useRef, useState } from 'react';
import { Job, JobStatus } from '../types';
import { MapPin, Loader2 } from 'lucide-react';
import { useLanguage } from '../contexts/LanguageContext';

// Declare Leaflet types since we are using CDN
declare const L: any;

interface JobMapProps {
  jobs: Job[];
}

// Fallback Coordinates for major Norwegian cities
const CITY_COORDS: Record<string, [number, number]> = {
    "oslo": [59.9139, 10.7522],
    "bergen": [60.3913, 5.3221],
    "trondheim": [63.4305, 10.3951],
    "stavanger": [58.9690, 5.7331],
    "drammen": [59.7441, 10.2045],
    "fredrikstad": [59.2205, 10.9347],
    "kristiansand": [58.1599, 8.0182],
    "sandnes": [58.8524, 5.7352],
    "tromsø": [69.6492, 18.9553],
    "tromso": [69.6492, 18.9553],
    "sarpsborg": [59.2840, 11.1096],
    "skien": [59.2096, 9.6088],
    "ålesund": [62.4722, 6.1495],
    "aalesund": [62.4722, 6.1495],
    "sandefjord": [59.1312, 10.2166],
    "haugesund": [59.4136, 5.2680],
    "tønsberg": [59.2675, 10.4076],
    "tonsberg": [59.2675, 10.4076],
    "moss": [59.4340, 10.6577],
    "porsgrunn": [59.1405, 9.6561],
    "bodø": [67.2804, 14.4049],
    "bodo": [67.2804, 14.4049],
    "arendal": [58.4610, 8.7725],
    "hamar": [60.7945, 11.0679],
    "larvik": [59.0533, 10.0352],
    "halden": [59.1243, 11.3875],
    "lillehammer": [61.1153, 10.4662],
    "gjøvik": [60.7954, 10.6916],
    "gjovik": [60.7954, 10.6916],
    "molde": [62.7372, 7.1607],
    "kongsberg": [59.6685, 9.6502],
    "horten": [59.4172, 10.4848],
    "gjesdal": [58.7947, 5.9506],
    "askøy": [60.4178, 5.2176],
    "askoy": [60.4178, 5.2176],
    "bærum": [59.8944, 10.5269],
    "baerum": [59.8944, 10.5269],
    "asker": [59.8331, 10.4391],
    "lillestrøm": [59.9560, 11.0502],
    "lillestrom": [59.9560, 11.0502],
    "nord-norge": [69.6492, 18.9553], 
    "vestland": [60.3913, 5.3221], 
    "rogaland": [58.9690, 5.7331], 
    "trøndelag": [63.4305, 10.3951], 
    "norway": [60.4720, 8.4689], // Center
    "norge": [60.4720, 8.4689],
};

const getColorByStatus = (status: string) => {
    const s = (status || '').toUpperCase();
    if (s.includes('NEW')) return '#3b82f6'; // Bright Blue
    if (s.includes('ANALYZED')) return '#a855f7'; // Bright Purple
    if (s.includes('APPROVED') || s.includes('DRAFT') || s.includes('MANUAL')) return '#f97316'; // Bright Orange
    if (s.includes('SENT') || s.includes('APPLIED')) return '#22c55e'; // Bright Green
    if (s.includes('REJECTED') || s.includes('FAILED')) return '#ef4444'; // Red
    return '#64748b'; // Slate Grey
};

export const JobMap: React.FC<JobMapProps> = ({ jobs }) => {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<any>(null);
  const [geoJobs, setGeoJobs] = useState<any[]>([]);
  const { t } = useLanguage();

  // 1. Process Jobs to Coordinates
  useEffect(() => {
    const processed = jobs.map(job => {
        let city = 'Norway';
        if (job.location) {
            const parts = job.location.split(/,| \/ /);
            city = parts[0].trim().toLowerCase();
        }
        
        let coords = CITY_COORDS[city];
        
        if (!coords) {
            const partial = Object.keys(CITY_COORDS).find(k => city.includes(k));
            if (partial) coords = CITY_COORDS[partial];
        }

        if (!coords) coords = CITY_COORDS['norway'];

        // Add Jitter to prevent overlap
        const jitterLat = (Math.random() - 0.5) * 0.02;
        const jitterLng = (Math.random() - 0.5) * 0.04;

        return {
            ...job,
            lat: coords[0] + jitterLat,
            lng: coords[1] + jitterLng
        };
    });
    setGeoJobs(processed);
  }, [jobs]);

  // 2. Initialize Map
  useEffect(() => {
    if (!mapRef.current || mapInstance.current) return;

    const center: [number, number] = [64.0, 12.0]; 
    
    mapInstance.current = L.map(mapRef.current).setView(center, 5);

    L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
        subdomains: 'abcd',
        maxZoom: 19
    }).addTo(mapInstance.current);

  }, []);

  // 3. Update Markers
  useEffect(() => {
    if (!mapInstance.current) return;

    // Clear existing
    mapInstance.current.eachLayer((layer: any) => {
        if (layer instanceof L.CircleMarker) {
            mapInstance.current.removeLayer(layer);
        }
    });

    if (geoJobs.length === 0) return;

    const bounds = L.latLngBounds([]);

    geoJobs.forEach(job => {
        const color = getColorByStatus(job.status);
        
        const marker = L.circleMarker([job.lat, job.lng], {
            radius: 7,
            fillColor: color,
            color: '#ffffff', // White border
            weight: 2,
            opacity: 1,
            fillOpacity: 0.9
        }).addTo(mapInstance.current);

        const tooltipContent = `
            <div class="p-2 font-sans min-w-[150px]">
                <div class="font-bold text-sm text-slate-900 truncate">${job.title}</div>
                <div class="text-xs text-slate-600 truncate">${job.company}</div>
                <div class="text-xs text-slate-500 mb-2">${job.location}</div>
                <div class="flex items-center justify-between">
                    <div class="inline-block px-2 py-0.5 rounded text-[10px] font-bold text-white uppercase" style="background-color:${color}">
                        ${job.status}
                    </div>
                    ${job.matchScore ? `<div class="text-xs font-bold ${job.matchScore > 70 ? 'text-green-600' : 'text-yellow-600'}">${job.matchScore}%</div>` : ''}
                </div>
            </div>
        `;

        marker.bindPopup(tooltipContent);
        bounds.extend([job.lat, job.lng]);
    });

    if (geoJobs.length > 0) {
        mapInstance.current.fitBounds(bounds, { padding: [50, 50] });
    }

  }, [geoJobs]);

  return (
    <div className="relative w-full h-full rounded-lg overflow-hidden">
        <div ref={mapRef} className="w-full h-full bg-slate-100 z-0" />
        
        {/* Legend */}
        <div className="absolute bottom-4 left-4 bg-white/95 p-3 rounded-lg shadow-lg backdrop-blur-sm z-[1000] text-xs space-y-2 border border-slate-200 min-w-[120px]">
            <div className="font-bold text-slate-700 border-b border-slate-100 pb-1 mb-1">Status</div>
            <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-[#3b82f6] border-2 border-white shadow-sm"></span> {t('jobs.status.new')}</div>
            <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-[#a855f7] border-2 border-white shadow-sm"></span> {t('jobs.status.analyzed')}</div>
            <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-[#f97316] border-2 border-white shadow-sm"></span> {t('jobs.status.draft')}</div>
            <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-[#22c55e] border-2 border-white shadow-sm"></span> {t('jobs.status.sent')}</div>
            <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-[#ef4444] border-2 border-white shadow-sm"></span> {t('jobs.status.rejected')}</div>
        </div>
    </div>
  );
};
