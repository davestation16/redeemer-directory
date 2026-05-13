import React, { useState, useCallback } from 'react';
import Papa from 'papaparse';
import { useDropzone } from 'react-dropzone';
import { Upload, FileText, Check, AlertCircle, Loader2, ChevronRight } from 'lucide-react';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import { collection, writeBatch, doc, serverTimestamp, getDocs } from 'firebase/firestore';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'motion/react';

const REQUIRED_FIELDS = {
  familyName: 'Family Name',
};

const OPTIONAL_FIELDS = {
  adult1Name: 'Adult 1 Name',
  adult1Phone: 'Adult 1 Phone',
  adult1Email: 'Adult 1 Email',
  adult2Name: 'Adult 2 Name',
  children: 'Children (comma separated)',
  address: 'Address',
};

type FieldKey = keyof typeof REQUIRED_FIELDS | keyof typeof OPTIONAL_FIELDS;

export default function BulkImport() {
  const [file, setFile] = useState<File | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [data, setData] = useState<any[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [step, setStep] = useState<'upload' | 'map' | 'preview' | 'importing'>('upload');
  const [progress, setProgress] = useState(0);

  const generateInviteCode = (length = 6) => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Avoid ambiguous characters
    let result = '';
    for (let i = 0; i < length; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  };

  const onDrop = useCallback((acceptedFiles: File[]) => {
    const selectedFile = acceptedFiles[0];
    if (selectedFile) {
      setFile(selectedFile);
      Papa.parse(selectedFile, {
        header: true,
        skipEmptyLines: true,
        complete: (results: any) => {
          if (results.meta.fields) {
            setHeaders(results.meta.fields);
            setData(results.data);
            
            // Try auto-mapping
            const initialMapping: Record<string, string> = {};
            const allFields = { ...REQUIRED_FIELDS, ...OPTIONAL_FIELDS };
            
            results.meta.fields.forEach((header: string) => {
              const lowerHeader = header.toLowerCase().replace(/[^a-z0-9]/g, '');
              Object.entries(allFields).forEach(([key, label]) => {
                const lowerLabel = label.toLowerCase().replace(/[^a-z0-9]/g, '');
                if (lowerHeader.includes(lowerLabel) || lowerLabel.includes(lowerHeader)) {
                  initialMapping[key] = header;
                }
              });
            });
            
            setMapping(initialMapping);
            setStep('map');
          } else {
            toast.error("Could not find headers in CSV file");
          }
        },
        error: (error: any) => {
          toast.error(`Error parsing CSV: ${error.message}`);
        }
      });
    }
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'text/csv': ['.csv'] },
    multiple: false
  } as any);

  const handleImport = async () => {
    if (!mapping.familyName) {
      toast.error("Family Name mapping is required");
      return;
    }

    setStep('importing');
    let successCount = 0;
    let failCount = 0;
    let skipCount = 0;

    // Fetch existing families to prevent duplicates
    const existingSnap = await getDocs(collection(db, 'families'));
    const existingFamilyNames = new Set(existingSnap.docs.map(d => (d.data().familyName || '').toLowerCase().trim()));
    const existingEmails = new Set();
    existingSnap.docs.forEach(d => {
      const members = d.data().members || [];
      members.forEach((m: any) => {
        if (m.email) existingEmails.add(m.email.toLowerCase().trim());
      });
    });
    
    // Firestore batch limit is 500
    const BATCH_SIZE = 500;
    const totalBatches = Math.ceil(data.length / BATCH_SIZE);

    for (let b = 0; b < totalBatches; b++) {
      const batch = writeBatch(db);
      const start = b * BATCH_SIZE;
      const end = Math.min(start + BATCH_SIZE, data.length);
      const currentBatchData = data.slice(start, end);

      for (const row of currentBatchData) {
        try {
          const rawFamilyName = row[mapping.familyName];
          const familyName = typeof rawFamilyName === 'string' ? rawFamilyName.trim() : rawFamilyName;
          
          if (!familyName) {
            failCount++;
            continue;
          }

          const kids = mapping.children && typeof row[mapping.children] === 'string'
            ? row[mapping.children].split(',').map((s: string) => s.trim()).filter(Boolean) 
            : [];

          const getVal = (field: string) => {
            const val = mapping[field] ? row[mapping[field]] : null;
            if (typeof val === 'string') {
              const trimmed = val.trim();
              return trimmed === '' ? null : trimmed;
            }
            return val || null;
          };

          const members = [];
          const primaryAdultEmail = getVal('adult1Email');

          // Duplicate detection
          const normalizedName = familyName.toLowerCase();
          const normalizedEmail = primaryAdultEmail?.toLowerCase();

          if (existingFamilyNames.has(normalizedName)) {
            skipCount++;
            continue;
          }

          if (normalizedEmail && existingEmails.has(normalizedEmail)) {
            skipCount++;
            continue;
          }

          if (getVal('adult1Name')) {
            members.push({
              name: getVal('adult1Name'),
              phone: getVal('adult1Phone'),
              email: primaryAdultEmail,
              role: 'Primary Adult'
            });
          }
          
          if (getVal('adult2Name')) {
            members.push({
              name: getVal('adult2Name'),
              role: 'Additional Adult/Parent'
            });
          }

          kids.forEach((kid: string) => {
            members.push({
              name: kid,
              role: 'Child'
            });
          });

          const familyRef = doc(collection(db, 'families'));
          const code = generateInviteCode(6);
          const magicLink = `https://directory.redeemeratl.org/invite?code=${code}`;

          batch.set(familyRef, {
            familyName,
            members,
            address: getVal('address'),
            memberUids: [],
            photoStatus: 'approved',
            initialMagicLink: magicLink,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });

          const inviteRef = doc(collection(db, 'invite_codes'));
          batch.set(inviteRef, {
            code,
            familyId: familyRef.id,
            familyName,
            maxUses: 10,
            usedCount: 0,
            invitedEmails: [primaryAdultEmail].filter(Boolean),
            status: 'active',
            createdAt: serverTimestamp(),
          });

          successCount++;
        } catch (error) {
          console.error(error);
          failCount++;
        }
      }

      try {
        await batch.commit();
      } catch (error) {
        handleFirestoreError(error, OperationType.WRITE, 'families_bulk_import');
      }
      setProgress(Math.round(((b + 1) / totalBatches) * 100));
    }

    toast.success(`Import complete: ${successCount} added, ${skipCount} skipped (duplicates), ${failCount} failed`);
    setStep('upload');
    setFile(null);
    setData([]);
    setHeaders([]);
    setMapping({});
    setProgress(0);
  };

  return (
    <div className="max-w-4xl mx-auto py-12 px-6">
      <AnimatePresence mode="wait">
        {step === 'upload' && (
          <motion.div 
            key="upload"
            initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}
            className="space-y-8"
          >
            <div className="text-center space-y-4">
              <h2 className="text-3xl font-serif text-stone">Bulk Import Families</h2>
              <p className="text-stone-light max-w-md mx-auto">
                Upload a CSV file to add multiple families to the directory at once. You can map your spreadsheet columns to our directory fields in the next step.
              </p>
            </div>

            <div 
              {...getRootProps()} 
              className={`border-4 border-dashed rounded-[3rem] p-20 text-center transition-all cursor-pointer ${
                isDragActive ? 'border-sage bg-sage/5 scale-[0.99]' : 'border-stone-border hover:border-sage/50 hover:bg-stone-border/20'
              }`}
            >
              <input {...getInputProps()} />
              <div className="bg-sage/10 w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-6 text-sage">
                <Upload size={32} />
              </div>
              <p className="text-lg font-medium text-stone mb-2">
                {isDragActive ? "Drop the CSV here" : "Drag & drop your CSV file here"}
              </p>
              <p className="text-sm text-stone-light">
                or click to browse from your computer
              </p>
            </div>

            <div className="bg-stone/5 rounded-3xl p-8 border border-stone-border">
              <div className="flex items-start gap-4">
                <div className="p-3 bg-white rounded-2xl text-stone shadow-sm">
                  <FileText size={20} />
                </div>
                <div>
                  <h4 className="font-bold text-stone mb-1">CSV Requirements</h4>
                  <ul className="text-sm text-stone-light space-y-2">
                    <li>• First row must contain column headers</li>
                    <li>• Must include a 'Family Name' column</li>
                    <li>• UTF-8 encoding recommended for special characters</li>
                  </ul>
                </div>
              </div>
            </div>
          </motion.div>
        )}

        {step === 'map' && (
          <motion.div 
            key="map"
            initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 1.05 }}
            className="bg-white rounded-[3rem] shadow-card border border-stone-border overflow-hidden"
          >
            <div className="p-10 border-b border-stone-border bg-stone-border/10 flex justify-between items-center">
              <div>
                <h3 className="text-2xl font-serif text-stone">Field Mapping Wizard</h3>
                <p className="text-xs uppercase tracking-widest font-bold text-stone-light mt-1">
                  File: {file?.name} ({data.length} rows detected)
                </p>
              </div>
              <button 
                onClick={() => setStep('upload')}
                className="text-stone-light hover:text-stone font-bold text-[10px] uppercase tracking-widest"
              >
                Cancel
              </button>
            </div>

            <div className="p-10 space-y-10">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-12">
                <div className="space-y-6">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 bg-sage text-white rounded-full flex items-center justify-center text-xs font-bold">1</div>
                    <h4 className="font-serif text-lg">Define Required Fields</h4>
                  </div>
                  {Object.entries(REQUIRED_FIELDS).map(([key, label]) => (
                    <div key={key} className="space-y-2">
                       <label className="block text-[10px] uppercase font-bold text-stone-light">{label} *</label>
                       <select 
                         value={mapping[key] || ''}
                         onChange={(e) => setMapping({ ...mapping, [key]: e.target.value })}
                         className="w-full p-4 bg-gray-50 border border-stone-border rounded-2xl outline-none focus:ring-4 focus:ring-sage/5 transition-all text-sm"
                       >
                         <option value="">Select CSV Column...</option>
                         {headers.map(h => (
                           <option key={h} value={h}>{h}</option>
                         ))}
                       </select>
                    </div>
                  ))}
                </div>

                <div className="space-y-6">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 bg-stone text-white rounded-full flex items-center justify-center text-xs font-bold">2</div>
                    <h4 className="font-serif text-lg">Map Optional Data</h4>
                  </div>
                  <div className="grid grid-cols-1 gap-4 max-h-[400px] overflow-y-auto pr-2">
                    {Object.entries(OPTIONAL_FIELDS).map(([key, label]) => (
                      <div key={key} className="space-y-2">
                         <label className="block text-[10px] uppercase font-bold text-stone-light">{label}</label>
                         <select 
                           value={mapping[key] || ''}
                           onChange={(e) => setMapping({ ...mapping, [key]: e.target.value })}
                           className="w-full p-3 bg-gray-50 border border-stone-border rounded-xl outline-none focus:ring-4 focus:ring-sage/5 transition-all text-sm"
                         >
                           <option value="">Skip this field</option>
                           {headers.map(h => (
                             <option key={h} value={h}>{h}</option>
                           ))}
                         </select>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="pt-8 border-t border-stone-border flex justify-between items-center">
                <div className="text-xs text-stone-light flex items-center gap-2">
                  <AlertCircle size={14} className="text-terracotta" />
                  Mapping complete? Proceed to final preview.
                </div>
                <button 
                  onClick={() => setStep('preview')}
                  disabled={!mapping.familyName}
                  className="bg-sage text-white px-10 py-4 rounded-full font-bold uppercase tracking-widest text-xs hover:brightness-110 transition-all shadow-lg shadow-sage/10 disabled:opacity-50 disabled:grayscale flex items-center gap-3"
                >
                  Review Samples <ChevronRight size={16} />
                </button>
              </div>
            </div>
          </motion.div>
        )}

        {step === 'preview' && (
          <motion.div 
            key="preview"
            initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}
            className="space-y-8"
          >
            <div className="flex justify-between items-end">
              <div>
                <h3 className="text-3xl font-serif text-stone">Preview & Confirm</h3>
                <p className="text-stone-light mt-1">Reviewing the first 5 records as they will appear in the directory.</p>
              </div>
              <button 
                onClick={() => setStep('map')}
                className="text-sage font-bold text-[10px] uppercase tracking-widest hover:underline"
              >
                Go Back to Mapping
              </button>
            </div>

            <div className="bg-white rounded-[2rem] border border-stone-border shadow-sm overflow-hidden overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-stone-border/10 border-b border-stone-border">
                    <th className="p-4 text-[10px] uppercase font-bold text-stone-light tracking-widest">Family Name</th>
                    <th className="p-4 text-[10px] uppercase font-bold text-stone-light tracking-widest">Adult 1</th>
                    <th className="p-4 text-[10px] uppercase font-bold text-stone-light tracking-widest">Contact</th>
                    <th className="p-4 text-[10px] uppercase font-bold text-stone-light tracking-widest">Address</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-border/50">
                  {data.slice(0, 5).map((row, i) => (
                    <tr key={i} className="hover:bg-stone/5 transition-colors">
                      <td className="p-4 font-serif text-stone">{row[mapping.familyName] || <span className="text-terracotta italic">Missing</span>}</td>
                      <td className="p-4 text-xs font-semibold text-stone">{row[mapping.adult1Name] || <span className="text-stone-light italic">None</span>}</td>
                      <td className="p-4 space-y-1">
                        {row[mapping.adult1Email] && <div className="text-[10px] text-stone-light">{row[mapping.adult1Email]}</div>}
                        {row[mapping.adult1Phone] && <div className="text-[10px] text-stone-light">{row[mapping.adult1Phone]}</div>}
                        {!row[mapping.adult1Email] && !row[mapping.adult1Phone] && <span className="text-[10px] text-stone-light italic">No Contact Info</span>}
                      </td>
                      <td className="p-4 text-[10px] text-stone-light max-w-[200px] truncate">
                        {row[mapping.address] || <span className="italic">No Address</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="bg-terracotta/5 border border-terracotta/20 rounded-3xl p-8 flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="p-3 bg-terracotta/10 text-terracotta rounded-full">
                  <Check size={20} />
                </div>
                <div>
                  <p className="font-bold text-stone">Found {data.length} rows to import</p>
                  <p className="text-xs text-stone-light">All records will be marked as 'Photo Pending' by default.</p>
                </div>
              </div>
              <button 
                onClick={handleImport}
                className="bg-terracotta text-white px-12 py-5 rounded-full font-bold uppercase tracking-widest text-xs hover:brightness-110 shadow-xl shadow-terracotta/20 transition-all"
              >
                Start Bulk Import
              </button>
            </div>
          </motion.div>
        )}

        {step === 'importing' && (
          <motion.div 
            key="importing"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }}
            className="max-w-md mx-auto text-center py-20 bg-white rounded-[3rem] border border-stone-border shadow-2xl space-y-8"
          >
            <div className="relative inline-block">
              <div className="w-24 h-24 border-4 border-sage/10 rounded-full"></div>
              <div 
                className="absolute inset-0 border-4 border-sage rounded-full transition-all duration-300"
                style={{ 
                  clipPath: `inset(0 ${100 - progress}% 0 0)`,
                  borderColor: 'rgb(var(--color-sage))'
                }}
              ></div>
              <div className="absolute inset-0 flex items-center justify-center font-bold text-sage">
                {progress}%
              </div>
            </div>
            
            <div className="space-y-2">
              <h3 className="text-2xl font-serif text-stone">Processing Records</h3>
              <p className="text-sm text-stone-light">Please keep this window open while we upload your directory data.</p>
            </div>

            <div className="px-12">
              <div className="h-2 bg-stone-border rounded-full overflow-hidden">
                <div 
                  className="h-full bg-sage transition-all duration-300"
                  style={{ width: `${progress}%` }}
                ></div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
