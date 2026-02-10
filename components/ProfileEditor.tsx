
import React, { useState, useEffect } from 'react';
import { StructuredProfile, WorkExperience, Education, TechnicalSkills, LanguageSkill } from '../types';
import { Save, Plus, Trash2, ChevronDown, ChevronUp, Briefcase, GraduationCap, Code, User, Globe, Award, Heart } from 'lucide-react';

interface ProfileEditorProps {
  initialData: StructuredProfile;
  onSave: (data: StructuredProfile) => Promise<void>;
}

const DEFAULT_PROFILE: StructuredProfile = {
    personalInfo: { fullName: '', email: '', phone: '', website: '', driverLicense: '', birthDate: '', nationality: '', gender: '', address: { street: '', postalCode: '', city: '', country: '' } },
    professionalSummary: '',
    workExperience: [],
    education: [],
    technicalSkills: { aiTools: [], programmingLanguages: [], frameworks: [], databases: [], cloudPlatforms: [], developmentTools: [], other: [] },
    softSkills: [],
    languages: [],
    certifications: [],
    interests: []
};

export const ProfileEditor: React.FC<ProfileEditorProps> = ({ initialData, onSave }) => {
  // Robust initialization to prevent undefined errors
  const initProfile = (data: StructuredProfile): StructuredProfile => {
      const safeData = (data || {}) as Partial<StructuredProfile>;
      const safePersonal = (safeData.personalInfo || {}) as Partial<StructuredProfile['personalInfo']>;
      const safeTech = (safeData.technicalSkills || {}) as Partial<TechnicalSkills>;
      
      // Explicitly handle arrays to avoid "undefined" if API returns null
      return {
        ...DEFAULT_PROFILE,
        ...safeData,
        personalInfo: {
            fullName: safePersonal.fullName || '',
            email: safePersonal.email || '',
            phone: safePersonal.phone || '',
            website: safePersonal.website || '',
            driverLicense: safePersonal.driverLicense || '',
            birthDate: safePersonal.birthDate || '',
            nationality: safePersonal.nationality || '',
            gender: safePersonal.gender || '',
            address: {
                street: safePersonal.address?.street || '',
                postalCode: safePersonal.address?.postalCode || '',
                city: safePersonal.address?.city || '',
                country: safePersonal.address?.country || ''
            }
        },
        professionalSummary: safeData.professionalSummary || '',
        workExperience: Array.isArray(safeData.workExperience) ? safeData.workExperience : [],
        education: Array.isArray(safeData.education) ? safeData.education : [],
        technicalSkills: {
            aiTools: Array.isArray(safeTech.aiTools) ? safeTech.aiTools! : [],
            programmingLanguages: Array.isArray(safeTech.programmingLanguages) ? safeTech.programmingLanguages! : [],
            frameworks: Array.isArray(safeTech.frameworks) ? safeTech.frameworks! : [],
            databases: Array.isArray(safeTech.databases) ? safeTech.databases! : [],
            cloudPlatforms: Array.isArray(safeTech.cloudPlatforms) ? safeTech.cloudPlatforms! : [],
            developmentTools: Array.isArray(safeTech.developmentTools) ? safeTech.developmentTools! : [],
            other: Array.isArray(safeTech.other) ? safeTech.other! : []
        },
        softSkills: Array.isArray(safeData.softSkills) ? safeData.softSkills : [],
        languages: Array.isArray(safeData.languages) ? safeData.languages : [],
        certifications: Array.isArray(safeData.certifications) ? safeData.certifications : [],
        interests: Array.isArray(safeData.interests) ? safeData.interests : []
      };
  };

  const [profile, setProfile] = useState<StructuredProfile>(initProfile(initialData));
  const [expandedSection, setExpandedSection] = useState<string | null>('personal');
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    setProfile(initProfile(initialData));
  }, [initialData]);

  const toggleSection = (sec: string) => setExpandedSection(expandedSection === sec ? null : sec);

  const handleSave = async () => {
    setIsSaving(true);
    await onSave(profile);
    setIsSaving(false);
  };

  // --- Update Handlers ---
  const updatePersonal = (field: string, value: string) => {
    setProfile(prev => ({ ...prev, personalInfo: { ...prev.personalInfo, [field]: value } }));
  };

  const updateAddress = (field: 'street' | 'postalCode' | 'city' | 'country', value: string) => {
      setProfile(prev => ({
          ...prev,
          personalInfo: {
              ...prev.personalInfo,
              address: { ...(prev.personalInfo.address || { street: '', postalCode: '', city: '', country: '' }), [field]: value }
          }
      }));
  };

  // Generic Array Add/Remove
  const addToArray = <T,>(field: keyof StructuredProfile, newItem: T) => {
      setProfile(prev => ({ ...prev, [field]: [newItem, ...(prev[field] as any[])] }));
  };
  const removeFromArray = (field: keyof StructuredProfile, idx: number) => {
      const list = [...(profile[field] as any[])];
      list.splice(idx, 1);
      setProfile(prev => ({ ...prev, [field]: list }));
  };
  const updateArrayItem = (field: keyof StructuredProfile, idx: number, subField: string, value: any) => {
      const list = [...(profile[field] as any[])];
      list[idx] = { ...list[idx], [subField]: value };
      setProfile(prev => ({ ...prev, [field]: list }));
  };

  // Skills Handler
  const updateTechSkills = (category: keyof TechnicalSkills, value: string) => {
      const arr = value.split(',').map(s => s.trim()).filter(s => s);
      setProfile(prev => ({
          ...prev,
          technicalSkills: { ...prev.technicalSkills, [category]: arr }
      }));
  };

  // Simple List Handler (Strings)
  const updateSimpleList = (field: keyof StructuredProfile, value: string) => {
      const arr = value.split('\n').filter(s => s.trim());
      setProfile(prev => ({ ...prev, [field]: arr }));
  };

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        {/* Toolbar */}
        <div className="bg-slate-50 p-4 border-b border-slate-200 flex justify-between items-center sticky top-0 z-10">
            <div>
                <h3 className="font-bold text-slate-700 flex items-center gap-2"><User size={18}/> Structured Editor</h3>
                <p className="text-[10px] text-slate-400">Saving here updates the legacy text automatically.</p>
            </div>
            <button onClick={handleSave} disabled={isSaving} className="bg-green-600 text-white px-4 py-2 rounded-lg flex items-center gap-2 text-sm hover:bg-green-700 shadow-sm transition-colors">
                <Save size={16}/> {isSaving ? 'Saving...' : 'Save Changes'}
            </button>
        </div>

        <div className="p-6 space-y-4 bg-slate-50/30">
            
            {/* 1. Personal Info */}
            <div className="bg-white rounded-lg border border-slate-200 overflow-hidden shadow-sm">
                <div onClick={() => toggleSection('personal')} className="p-4 bg-slate-50 cursor-pointer flex justify-between items-center hover:bg-slate-100">
                    <div className="flex items-center gap-2 font-bold text-slate-700"><User size={18}/> Personal Information</div>
                    {expandedSection === 'personal' ? <ChevronUp size={18}/> : <ChevronDown size={18}/>}
                </div>
                {expandedSection === 'personal' && (
                    <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div><label className="text-xs font-bold text-slate-500 uppercase">Full Name</label><input className="w-full border p-2 rounded text-sm" value={profile.personalInfo.fullName || ''} onChange={e => updatePersonal('fullName', e.target.value)} /></div>
                        <div><label className="text-xs font-bold text-slate-500 uppercase">Email</label><input className="w-full border p-2 rounded text-sm" value={profile.personalInfo.email || ''} onChange={e => updatePersonal('email', e.target.value)} /></div>
                        <div><label className="text-xs font-bold text-slate-500 uppercase">Phone</label><input className="w-full border p-2 rounded text-sm" value={profile.personalInfo.phone || ''} onChange={e => updatePersonal('phone', e.target.value)} /></div>
                        <div><label className="text-xs font-bold text-slate-500 uppercase">Website/LinkedIn</label><input className="w-full border p-2 rounded text-sm" value={profile.personalInfo.website || ''} onChange={e => updatePersonal('website', e.target.value)} /></div>
                        <div><label className="text-xs font-bold text-slate-500 uppercase">Driver's License</label><input className="w-full border p-2 rounded text-sm" placeholder="e.g. B, BE, C1" value={profile.personalInfo.driverLicense || ''} onChange={e => updatePersonal('driverLicense', e.target.value)} /></div>
                        <div><label className="text-xs font-bold text-slate-500 uppercase">Birth Date</label><input type="date" className="w-full border p-2 rounded text-sm" value={profile.personalInfo.birthDate || ''} onChange={e => updatePersonal('birthDate', e.target.value)} /></div>
                        <div><label className="text-xs font-bold text-slate-500 uppercase">Nationality</label><input className="w-full border p-2 rounded text-sm" placeholder="e.g. Norsk, Ukrainsk" value={profile.personalInfo.nationality || ''} onChange={e => updatePersonal('nationality', e.target.value)} /></div>
                        <div><label className="text-xs font-bold text-slate-500 uppercase">Gender</label>
                            <select className="w-full border p-2 rounded text-sm bg-white" value={profile.personalInfo.gender || ''} onChange={e => updatePersonal('gender', e.target.value)}>
                                <option value="">-- Select --</option>
                                <option value="Mann">Mann</option>
                                <option value="Kvinne">Kvinne</option>
                                <option value="Annet">Annet</option>
                            </select>
                        </div>
                        <div><label className="text-xs font-bold text-slate-500 uppercase">Street Address</label><input className="w-full border p-2 rounded text-sm" placeholder="e.g. Teknologiveien 12" value={profile.personalInfo.address?.street || ''} onChange={e => updateAddress('street', e.target.value)} /></div>
                        <div className="grid grid-cols-3 gap-2 md:col-span-1">
                             <div><label className="text-xs font-bold text-slate-500 uppercase">Postal Code</label><input className="w-full border p-2 rounded text-sm" placeholder="e.g. 2815" value={profile.personalInfo.address?.postalCode || ''} onChange={e => updateAddress('postalCode', e.target.value)} /></div>
                             <div><label className="text-xs font-bold text-slate-500 uppercase">City</label><input className="w-full border p-2 rounded text-sm" value={profile.personalInfo.address?.city || ''} onChange={e => updateAddress('city', e.target.value)} /></div>
                             <div><label className="text-xs font-bold text-slate-500 uppercase">Country</label><input className="w-full border p-2 rounded text-sm" value={profile.personalInfo.address?.country || ''} onChange={e => updateAddress('country', e.target.value)} /></div>
                        </div>
                        <div className="md:col-span-2"><label className="text-xs font-bold text-slate-500 uppercase">Professional Summary</label><textarea className="w-full border p-2 rounded text-sm h-24" value={profile.professionalSummary || ''} onChange={e => setProfile({...profile, professionalSummary: e.target.value})} /></div>
                    </div>
                )}
            </div>

            {/* 2. Work Experience */}
            <div className="bg-white rounded-lg border border-slate-200 overflow-hidden shadow-sm">
                <div onClick={() => toggleSection('work')} className="p-4 bg-slate-50 cursor-pointer flex justify-between items-center hover:bg-slate-100">
                    <div className="flex items-center gap-2 font-bold text-slate-700"><Briefcase size={18}/> Work Experience</div>
                    <div className="flex items-center gap-2">
                        <button onClick={(e) => {e.stopPropagation(); addToArray<WorkExperience>('workExperience', { company: 'New Company', position: 'Role', startDate: '', endDate: '', responsibilities: [] })}} className="text-blue-600 p-1 hover:bg-blue-100 rounded"><Plus size={16}/></button>
                        {expandedSection === 'work' ? <ChevronUp size={18}/> : <ChevronDown size={18}/>}
                    </div>
                </div>
                {expandedSection === 'work' && (
                    <div className="p-4 space-y-4">
                        {profile.workExperience.map((job, idx) => (
                            <div key={idx} className="border border-slate-200 rounded-lg p-3 bg-slate-50/50 relative group">
                                <button onClick={() => removeFromArray('workExperience', idx)} className="absolute top-2 right-2 text-red-400 hover:text-red-600 p-1 bg-white rounded shadow-sm opacity-0 group-hover:opacity-100 transition-opacity"><Trash2 size={14}/></button>
                                <div className="grid grid-cols-2 gap-2 mb-2">
                                    <div><label className="text-[10px] font-bold text-slate-400 uppercase">Company</label><input className="w-full border p-1.5 rounded text-sm" value={job.company || ''} onChange={e => updateArrayItem('workExperience', idx, 'company', e.target.value)} /></div>
                                    <div><label className="text-[10px] font-bold text-slate-400 uppercase">Position</label><input className="w-full border p-1.5 rounded text-sm" value={job.position || ''} onChange={e => updateArrayItem('workExperience', idx, 'position', e.target.value)} /></div>
                                    <div><label className="text-[10px] font-bold text-slate-400 uppercase">Start</label><input className="w-full border p-1.5 rounded text-sm" value={job.startDate || ''} onChange={e => updateArrayItem('workExperience', idx, 'startDate', e.target.value)} /></div>
                                    <div><label className="text-[10px] font-bold text-slate-400 uppercase">End</label><input className="w-full border p-1.5 rounded text-sm" value={job.endDate || ''} onChange={e => updateArrayItem('workExperience', idx, 'endDate', e.target.value)} /></div>
                                </div>
                                <div><label className="text-[10px] font-bold text-slate-400 uppercase">Responsibilities (one per line)</label><textarea className="w-full border p-2 rounded text-xs h-24" value={(job.responsibilities || []).join('\n')} onChange={e => updateArrayItem('workExperience', idx, 'responsibilities', e.target.value.split('\n'))} /></div>
                            </div>
                        ))}
                        {profile.workExperience.length === 0 && <div className="text-center text-slate-400 italic text-sm py-4">No experience added. Click + to add.</div>}
                    </div>
                )}
            </div>

            {/* 3. Technical Skills */}
            <div className="bg-white rounded-lg border border-slate-200 overflow-hidden shadow-sm">
                <div onClick={() => toggleSection('tech')} className="p-4 bg-slate-50 cursor-pointer flex justify-between items-center hover:bg-slate-100">
                    <div className="flex items-center gap-2 font-bold text-slate-700"><Code size={18}/> Technical Skills</div>
                    {expandedSection === 'tech' ? <ChevronUp size={18}/> : <ChevronDown size={18}/>}
                </div>
                {expandedSection === 'tech' && (
                    <div className="p-4 space-y-3">
                        {Object.entries(profile.technicalSkills).map(([key, val]) => (
                            <div key={key}>
                                <label className="text-xs font-bold text-slate-500 uppercase">{key.replace(/([A-Z])/g, ' $1').trim()}</label>
                                <input 
                                    className="w-full border p-2 rounded text-sm font-mono text-blue-600 bg-slate-50" 
                                    value={Array.isArray(val) ? val.join(', ') : ''} 
                                    onChange={e => updateTechSkills(key as keyof TechnicalSkills, e.target.value)} 
                                    placeholder="Comma separated values..."
                                />
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* 4. Education */}
            <div className="bg-white rounded-lg border border-slate-200 overflow-hidden shadow-sm">
                <div onClick={() => toggleSection('edu')} className="p-4 bg-slate-50 cursor-pointer flex justify-between items-center hover:bg-slate-100">
                    <div className="flex items-center gap-2 font-bold text-slate-700"><GraduationCap size={18}/> Education</div>
                    <div className="flex items-center gap-2">
                        <button onClick={(e) => {e.stopPropagation(); addToArray<Education>('education', { institution: '', degree: '', field: '', graduationYear: '' })}} className="text-blue-600 p-1 hover:bg-blue-100 rounded"><Plus size={16}/></button>
                        {expandedSection === 'edu' ? <ChevronUp size={18}/> : <ChevronDown size={18}/>}
                    </div>
                </div>
                {expandedSection === 'edu' && (
                    <div className="p-4 space-y-3">
                        {profile.education.map((edu, idx) => (
                             <div key={idx} className="flex gap-2 items-start border-b border-slate-100 pb-2 last:border-0">
                                <div className="grid grid-cols-1 md:grid-cols-4 gap-2 flex-1">
                                    <input className="border p-1.5 rounded text-sm" placeholder="Institution" value={edu.institution || ''} onChange={e => updateArrayItem('education', idx, 'institution', e.target.value)} />
                                    <input className="border p-1.5 rounded text-sm" placeholder="Degree" value={edu.degree || ''} onChange={e => updateArrayItem('education', idx, 'degree', e.target.value)} />
                                    <input className="border p-1.5 rounded text-sm" placeholder="Field" value={edu.field || ''} onChange={e => updateArrayItem('education', idx, 'field', e.target.value)} />
                                    <input className="border p-1.5 rounded text-sm" placeholder="Year" value={edu.graduationYear || ''} onChange={e => updateArrayItem('education', idx, 'graduationYear', e.target.value)} />
                                </div>
                                <button onClick={() => removeFromArray('education', idx)} className="text-red-400 hover:text-red-600 p-1.5"><Trash2 size={14}/></button>
                             </div>
                        ))}
                    </div>
                )}
            </div>

            {/* 5. Languages & Certs */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Languages */}
                <div className="bg-white rounded-lg border border-slate-200 overflow-hidden shadow-sm">
                    <div onClick={() => toggleSection('lang')} className="p-4 bg-slate-50 cursor-pointer flex justify-between items-center hover:bg-slate-100">
                        <div className="flex items-center gap-2 font-bold text-slate-700"><Globe size={18}/> Languages</div>
                        <div className="flex items-center gap-2">
                             <button onClick={(e) => {e.stopPropagation(); addToArray<LanguageSkill>('languages', { language: '', proficiencyLevel: '' })}} className="text-blue-600 p-1 hover:bg-blue-100 rounded"><Plus size={16}/></button>
                             {expandedSection === 'lang' ? <ChevronUp size={18}/> : <ChevronDown size={18}/>}
                        </div>
                    </div>
                    {expandedSection === 'lang' && (
                        <div className="p-4 space-y-2">
                            {profile.languages.map((lang, idx) => (
                                <div key={idx} className="flex gap-2 items-center">
                                    <input className="border p-1.5 rounded text-sm flex-1" placeholder="Language" value={lang.language || ''} onChange={e => updateArrayItem('languages', idx, 'language', e.target.value)} />
                                    <input className="border p-1.5 rounded text-sm flex-1" placeholder="Level" value={lang.proficiencyLevel || ''} onChange={e => updateArrayItem('languages', idx, 'proficiencyLevel', e.target.value)} />
                                    <button onClick={() => removeFromArray('languages', idx)} className="text-red-400 hover:text-red-600"><Trash2 size={14}/></button>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* Certifications */}
                <div className="bg-white rounded-lg border border-slate-200 overflow-hidden shadow-sm">
                     <div onClick={() => toggleSection('certs')} className="p-4 bg-slate-50 cursor-pointer flex justify-between items-center hover:bg-slate-100">
                        <div className="flex items-center gap-2 font-bold text-slate-700"><Award size={18}/> Certifications</div>
                        {expandedSection === 'certs' ? <ChevronUp size={18}/> : <ChevronDown size={18}/>}
                    </div>
                    {expandedSection === 'certs' && (
                        <div className="p-4">
                             <textarea 
                                className="w-full border p-2 rounded text-sm h-32" 
                                placeholder="One per line..." 
                                value={(profile.certifications || []).join('\n')} 
                                onChange={e => updateSimpleList('certifications', e.target.value)}
                             />
                        </div>
                    )}
                </div>
            </div>
             {/* Soft Skills & Interests */}
             <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                 <div className="bg-white rounded-lg border border-slate-200 overflow-hidden shadow-sm">
                     <div className="p-4 bg-slate-50 font-bold text-slate-700 flex items-center gap-2"><Heart size={18}/> Soft Skills</div>
                     <div className="p-4">
                         <textarea className="w-full border p-2 rounded text-sm h-24" placeholder="One per line..." value={(profile.softSkills || []).join('\n')} onChange={e => updateSimpleList('softSkills', e.target.value)} />
                     </div>
                 </div>
                 <div className="bg-white rounded-lg border border-slate-200 overflow-hidden shadow-sm">
                     <div className="p-4 bg-slate-50 font-bold text-slate-700 flex items-center gap-2"><Briefcase size={18}/> Career Interests</div>
                     <div className="p-4">
                         <textarea className="w-full border p-2 rounded text-sm h-24" placeholder="One per line..." value={(profile.interests || []).join('\n')} onChange={e => updateSimpleList('interests', e.target.value)} />
                     </div>
                 </div>
             </div>

        </div>
    </div>
  );
};
