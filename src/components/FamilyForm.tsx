import React, { useState, useEffect, useRef } from 'react';
import { Family, FamilyMember } from '../types';
import { X, Plus, Trash2, Camera, Upload, Loader2, Check, Info } from 'lucide-react';
import { doc, setDoc, updateDoc, serverTimestamp, collection, addDoc, auth, db, storage, handleFirestoreError, OperationType } from '../lib/firebase';
import { getDownloadURL, ref, uploadBytesResumable } from 'firebase/storage';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'motion/react';
import imageCompression from 'browser-image-compression';

interface FamilyFormProps {
  family?: Family | null;
  onClose: () => void;
  onSave: () => void;
}

export default function FamilyForm({ family, onClose, onSave }: FamilyFormProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [formData, setFormData] = useState<Partial<Family>>({
    familyName: '',
    members: [],
    address: '',
    photoUrl: '',
    memberUids: [],
  });

  const [showRoleInfo, setShowRoleInfo] = useState<number | null>(null);

  useEffect(() => {
    if (family) {
      setFormData(family);
    }
  }, [family]);

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // 1. Check Authentication First
    if (!auth.currentUser) {
      toast.error("You must be logged in to upload photos");
      return;
    }

    setUploading(true);
    setUploadProgress(0);

    // 1.5 Verify auth state
    if (!auth.currentUser) {
      console.error("[FORM_UPLOAD_CRITICAL]: USER NOT AUTHENTICATED");
      toast.error("Authentication lost");
      setUploading(false);
      return;
    }

    console.log("[FORM_UPLOAD_START]: Initiating photo upload", { 
      fileName: file.name,
      userId: auth.currentUser.uid,
      projectId: db.app.options.projectId
    });

    try {
      // 2. Client-side compression
      const options = {
        maxSizeMB: 1,
        maxWidthOrHeight: 1200, // Reduced from 1920 to 1200 for even faster loading
        useWebWorker: true,
        fileType: 'image/jpeg' // Force conversion to JPEG
      };

      toast.info("Optimizing image...");
      const compressedFile = await imageCompression(file, options);
      console.log("[FORM_UPLOAD_COMPRESSION]: Image compressed");

      // Use the family ID if it exists, otherwise a temporary folder
      const uploadId = family?.id || `new-${Date.now()}`;
      const storagePath = `families/${uploadId}/photo_${Date.now()}`;
      const storageRef = ref(storage, storagePath);
      
      console.log("[FORM_UPLOAD_STORAGE_ATTEMPT]: Starting storage upload", { path: storagePath });
      const uploadTask = uploadBytesResumable(storageRef, compressedFile, { contentType: 'image/jpeg' });

      uploadTask.on('state_changed', 
        (snapshot) => {
          const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
          setUploadProgress(Math.round(progress));
          console.log(`[FORM_UPLOAD_PROGRESS]: ${Math.round(progress)}%`);
        }, 
        (errorObj: any) => {
          console.error("[FORM_UPLOAD_STORAGE_ERROR]: Storage upload failed", {
            code: errorObj.code,
            message: errorObj.message
          });
          handleFirestoreError(errorObj, OperationType.UPLOAD, storagePath);
          toast.error(`Photo upload failed: ${errorObj.message || "Unauthorized or Quota Exceeded"}`);
          setUploading(false);
          setUploadProgress(0);
        }, 
        async () => {
          try {
            console.log("[FORM_UPLOAD_STORAGE_SUCCESS]: Upload complete, retrieving URL");
            const url = await getDownloadURL(uploadTask.snapshot.ref);
            console.log("[FORM_UPLOAD_URL_RETRIEVED]: URL obtained", { url });
            
            setFormData(prev => ({ ...prev, photoUrl: url, photoStatus: 'pending' }));
            toast.success("Photo uploaded successfully. Changes will be saved on submit.");
          } catch (error: any) {
            console.error("[FORM_UPLOAD_URL_ERROR]: Failed to retrieve URL", {
              code: error.code,
              message: error.message
            });
            handleFirestoreError(error, OperationType.UPLOAD, storagePath);
            toast.error("Failed to retrieve uploaded photo URL");
          } finally {
            setUploading(false);
            setUploadProgress(0);
          }
        }
      );
    } catch (error) {
      console.error("[FORM_UPLOAD_INIT_ERROR]: Could not start upload sequence", error);
      handleFirestoreError(error, OperationType.UPLOAD, "families/temporary/photo");
      toast.error(`Could not start upload: ${error instanceof Error ? error.message : "Internal Error"}`);
      setUploading(false);
      setUploadProgress(0);
    }
  };

  const [isSaving, setIsSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    console.log("[FORM_SUBMIT_START]: Submitting family form", { 
      isEdit: !!family, 
      id: family?.id,
      familyName: formData.familyName 
    });

    const path = family ? `families/${family.id}` : 'families';
    setIsSaving(true);
    
    try {
      const payload: any = {
        familyName: formData.familyName?.trim(),
        members: formData.members || [],
        address: formData.address || '',
        photoUrl: formData.photoUrl || '',
        weddingAnniversary: formData.weddingAnniversary || null,
        memberUids: formData.memberUids || [],
        updatedAt: serverTimestamp(),
      };

      if (!payload.familyName) {
        toast.error("Family name is required");
        setIsSaving(false);
        return;
      }

      // If photoUrl changed or is new, force status to pending for approval queue
      if (formData.photoUrl && (!family || family.photoUrl !== formData.photoUrl)) {
        payload.photoStatus = 'pending';
      }

      if (family && family.id) {
        console.log("[FORM_SUBMIT_UPDATE]: Attempting update", { id: family.id });
        await updateDoc(doc(db, 'families', family.id), payload);
        console.log("[FORM_SUBMIT_UPDATE_SUCCESS]: Update complete");
        toast.success("Family updated successfully. New photos require admin approval.");
      } else {
        console.log("[FORM_SUBMIT_CREATE]: Attempting create");
        await addDoc(collection(db, 'families'), {
          ...payload,
          photoStatus: formData.photoUrl ? 'pending' : 'approved',
          createdAt: serverTimestamp(),
        });
        console.log("[FORM_SUBMIT_CREATE_SUCCESS]: Creation complete");
        toast.success("Family added successfully");
      }
      
      console.log("[FORM_SUBMIT_FINISH]: Calling onSave and onClose");
      onSave();
      onClose();
    } catch (error) {
      console.error("[FORM_SUBMIT_ERROR]: Critical failure during submit", error);
      handleFirestoreError(error, family ? OperationType.UPDATE : OperationType.CREATE, path);
    } finally {
      setIsSaving(false);
    }
  };

  const addMember = () => {
    setFormData(prev => ({
      ...prev,
      members: [...(prev.members || []), { name: '', role: 'Child' }]
    }));
  };

  const removeMember = (index: number) => {
    setFormData(prev => ({
      ...prev,
      members: prev.members?.filter((_, i) => i !== index)
    }));
  };

  const updateMember = (index: number, field: string, value: string) => {
    const newMembers = [...(formData.members || [])];
    newMembers[index] = { ...newMembers[index], [field]: value };
    setFormData(prev => ({ ...prev, members: newMembers }));
  };

  const MonthDayInput = ({ value, onChange, label }: { value?: string, onChange: (val: string) => void, label: string }) => {
    const [month, day] = (value || '').split('-').slice(-2);
    
    const months = [
      "January", "February", "March", "April", "May", "June",
      "July", "August", "September", "October", "November", "December"
    ];

    const handleMonthChange = (newMonth: string) => {
      const d = day || '01';
      onChange(`1000-${newMonth.padStart(2, '0')}-${d.padStart(2, '0')}`);
    };

    const handleDayChange = (newDay: string) => {
      const m = month || '01';
      onChange(`1000-${m.padStart(2, '0')}-${newDay.padStart(2, '0')}`);
    };

    return (
      <div className="space-y-1">
        <label className="text-[10px] uppercase font-bold text-stone-light tracking-widest">{label}</label>
        <div className="grid grid-cols-2 gap-2">
          <select 
            value={month || ''} 
            onChange={(e) => handleMonthChange(e.target.value)}
            className="w-full px-3 py-3 bg-gray-50/50 border border-stone-border rounded-xl outline-none focus:ring-4 focus:ring-sage/5 transition-all text-xs text-stone-light appearance-none"
          >
            <option value="">Month</option>
            {months.map((m, i) => (
              <option key={m} value={(i + 1).toString().padStart(2, '0')}>{m}</option>
            ))}
          </select>
          <select 
            value={day || ''} 
            onChange={(e) => handleDayChange(e.target.value)}
            className="w-full px-3 py-3 bg-gray-50/50 border border-stone-border rounded-xl outline-none focus:ring-4 focus:ring-sage/5 transition-all text-xs text-stone-light appearance-none"
          >
            <option value="">Day</option>
            {Array.from({ length: 31 }, (_, i) => (
              <option key={i + 1} value={(i + 1).toString().padStart(2, '0')}>{i + 1}</option>
            ))}
          </select>
        </div>
      </div>
    );
  };

  return (
    <div className="fixed inset-0 bg-stone/40 backdrop-blur-sm flex items-center justify-center p-4 z-50 overflow-y-auto">
      <motion.div 
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        className="bg-bg-natural rounded-[2rem] w-full max-w-2xl p-8 md:p-12 relative shadow-2xl my-8 border border-stone-border"
      >
        <button onClick={onClose} className="absolute right-8 top-8 text-stone-light hover:text-stone transition-colors">
          <X size={24} />
        </button>
        
        <h2 className="text-3xl font-serif mb-10 text-stone">{family ? "Edit Family" : "Add Family"}</h2>
        
        <form onSubmit={handleSubmit} className="space-y-10">
          <section className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div>
              <label className="block text-[10px] font-bold text-stone-light mb-2 uppercase tracking-[0.2em]">Family Identity</label>
              <input 
                type="text" 
                placeholder="e.g. The Miller Family"
                value={formData.familyName}
                onChange={(e) => setFormData({ ...formData, familyName: e.target.value })}
                className="w-full p-5 bg-white border border-stone-border rounded-2xl outline-none focus:ring-4 focus:ring-sage/5 text-xl font-serif text-stone placeholder:opacity-30"
                required
              />
            </div>
            <div>
              <MonthDayInput 
                label="Wedding Anniversary"
                value={formData.weddingAnniversary || ''}
                onChange={(val) => setFormData({ ...formData, weddingAnniversary: val })}
              />
            </div>
          </section>

          <section className="space-y-6">
            <div className="flex justify-between items-end">
              <div>
                <label className="block text-[10px] font-bold text-stone-light uppercase tracking-[0.2em]">Household Members</label>
                <p className="text-[10px] text-stone-light mt-1 uppercase tracking-wider opacity-60">Add adults, teens, and children living in this household.</p>
              </div>
              <button 
                type="button" 
                onClick={addMember}
                className="flex items-center gap-2 px-5 py-2.5 bg-sage-light text-sage rounded-full text-[10px] uppercase font-bold hover:bg-sage hover:text-white transition-all shadow-sm"
              >
                <Plus size={14} /> Add Member
              </button>
            </div>
            
            <div className="space-y-6">
              {formData.members?.map((member, i) => (
                <div key={i} className="p-6 bg-white border border-stone-border rounded-2xl space-y-4 relative group hover:border-sage/30 transition-all shadow-sm">
                  <button 
                    type="button" 
                    onClick={() => removeMember(i)}
                    className="absolute right-4 top-4 w-9 h-9 flex items-center justify-center text-stone-light hover:text-red-500 hover:bg-red-50 transition-all rounded-full"
                    title="Remove member"
                  >
                    <X size={18} />
                  </button>
                  
                  <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
                    <div className="lg:col-span-12 grid grid-cols-1 md:grid-cols-7 gap-4">
                      <div className="md:col-span-4 space-y-1">
                        <label className="text-[10px] uppercase font-bold text-stone-light tracking-widest">Full Name</label>
                        <input 
                          type="text" 
                          placeholder="Legal Name" 
                          value={member.name}
                          onChange={(e) => updateMember(i, 'name', e.target.value)}
                          className="w-full px-4 py-3 bg-gray-50/50 border border-stone-border rounded-xl outline-none focus:ring-4 focus:ring-sage/5 transition-all text-stone font-medium text-sm"
                          required
                        />
                      </div>
                      <div className="md:col-span-3 space-y-1 relative">
                        <div className="flex items-center gap-1.5 mb-1">
                          <label className="text-[10px] uppercase font-bold text-stone-light tracking-widest">Directory Role</label>
                          <button 
                            type="button"
                            onClick={() => setShowRoleInfo(showRoleInfo === i ? null : i)}
                            className="text-stone-light hover:text-sage transition-colors"
                          >
                            <Info size={12} />
                          </button>
                        </div>

                        <AnimatePresence>
                          {showRoleInfo === i && (
                            <>
                              <div 
                                className="fixed inset-0 z-40" 
                                onClick={() => setShowRoleInfo(null)}
                              />
                              <motion.div
                                initial={{ opacity: 0, scale: 0.95, y: 10 }}
                                animate={{ opacity: 1, scale: 1, y: 0 }}
                                exit={{ opacity: 0, scale: 0.95, y: 10 }}
                                className="absolute bottom-full left-0 mb-3 z-50 p-5 w-72 bg-white rounded-2xl shadow-xl border border-stone-border"
                              >
                                <div className="space-y-4">
                                  <div className="space-y-1">
                                    <p className="text-[10px] font-bold uppercase text-sage tracking-wider">Adult</p>
                                    <p className="text-xs text-stone-light leading-relaxed">
                                      Adults manage the household! You can update the main family details and add or remove members from your family.
                                    </p>
                                  </div>
                                  <div className="space-y-1">
                                    <p className="text-[10px] font-bold uppercase text-sage tracking-wider">Teen</p>
                                    <p className="text-xs text-stone-light leading-relaxed">
                                      Teens can add their own phone number or email to stay connected, but they can't change the main family details.
                                    </p>
                                  </div>
                                  <div className="space-y-1">
                                    <p className="text-[10px] font-bold uppercase text-sage tracking-wider">Child</p>
                                    <p className="text-xs text-stone-light leading-relaxed">
                                      Children keep it simple. We only ask for their birthday for church celebrations—no private contact info is ever collected!
                                    </p>
                                  </div>
                                </div>
                                <div className="absolute -bottom-2 left-4 w-4 h-4 bg-white border-b border-r border-stone-border rotate-45" />
                              </motion.div>
                            </>
                          )}
                        </AnimatePresence>

                        <div className="relative">
                          <select
                            value={member.role}
                            onChange={(e) => {
                              const newRole = e.target.value as any;
                              const newMembers = [...(formData.members || [])];
                              newMembers[i] = { 
                                ...newMembers[i], 
                                role: newRole,
                                // Clear restricted fields for children
                                ...(newRole === 'Child' ? { email: '', phone: '' } : {})
                              };
                              setFormData(prev => ({ ...prev, members: newMembers }));
                            }}
                            className="w-full px-4 py-3 bg-gray-50/50 border border-stone-border rounded-xl outline-none focus:ring-4 focus:ring-sage/5 transition-all text-stone font-medium text-sm appearance-none"
                          >
                            <option value="Adult">Adult</option>
                            <option value="Teen">Teen</option>
                            <option value="Child">Child</option>
                          </select>
                        </div>
                      </div>
                    </div>

                    <div className="lg:col-span-12 grid grid-cols-1 md:grid-cols-3 gap-4 pt-3 border-t border-stone-border/30">
                      <MonthDayInput 
                        label="Birthday"
                        value={member.birthday || ''}
                        onChange={(val) => updateMember(i, 'birthday', val)}
                      />
                      {member.role !== 'Child' && (
                        <>
                          <div className="space-y-1">
                            <label className="text-[10px] uppercase font-bold text-stone-light tracking-widest">Personal Email</label>
                            <input 
                              type="email" 
                              placeholder="email@example.com" 
                              value={member.email || ''}
                              onChange={(e) => updateMember(i, 'email', e.target.value)}
                              className="w-full px-4 py-3 bg-gray-50/50 border border-stone-border rounded-xl outline-none focus:ring-4 focus:ring-sage/5 transition-all text-xs text-stone-light"
                            />
                          </div>
                          <div className="space-y-1">
                            <label className="text-[10px] uppercase font-bold text-stone-light tracking-widest">Phone Number</label>
                            <input 
                              type="tel" 
                              placeholder="(555) 000-0000" 
                              value={member.phone || ''}
                              onChange={(e) => updateMember(i, 'phone', e.target.value)}
                              className="w-full px-4 py-3 bg-gray-50/50 border border-stone-border rounded-xl outline-none focus:ring-4 focus:ring-sage/5 transition-all text-xs text-stone-light"
                            />
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              ))}
              
              {(!formData.members || formData.members.length === 0) && (
                <div className="p-12 border-2 border-dashed border-stone-border rounded-[2rem] text-center space-y-4">
                  <p className="text-stone-light text-sm italic">No members added yet.</p>
                  <button 
                    type="button" 
                    onClick={addMember}
                    className="inline-flex items-center gap-2 px-6 py-3 bg-sage text-white rounded-full text-xs uppercase font-bold hover:brightness-110 transition-all shadow-md"
                  >
                    <Plus size={16} /> Start Adding Members
                  </button>
                </div>
              )}
            </div>
          </section>

          <section className="grid grid-cols-1 md:grid-cols-2 gap-10">
            <div className="space-y-2">
              <label className="block text-[10px] font-bold text-stone-light uppercase tracking-[0.2em]">Address</label>
              <textarea 
                value={formData.address}
                onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                className="w-full p-4 bg-white border border-stone-border rounded-xl outline-none focus:ring-4 focus:ring-sage/5 h-32 resize-none"
              />
            </div>
            <div className="space-y-4">
              <label className="block text-[10px] font-bold text-stone-light uppercase tracking-[0.2em]">Family Photo</label>
              
              <div 
                onClick={() => !uploading && fileInputRef.current?.click()}
                className="relative group overflow-hidden rounded-[2rem] bg-gray-50 border border-stone-border aspect-video flex items-center justify-center cursor-pointer"
              >
                {formData.photoUrl ? (
                  <>
                    <img 
                      src={formData.photoUrl} 
                      alt="Family" 
                      className="w-full h-full object-cover transition-transform group-hover:scale-105"
                    />
                    <div className="absolute inset-0 bg-stone/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                      <div className="p-5 bg-white text-stone rounded-full shadow-xl hover:scale-110 active:scale-95 transition-all">
                        <Camera size={24} />
                      </div>
                    </div>
                    {/* Status Badge */}
                    {formData.photoStatus === 'pending' && (
                       <div className="absolute top-4 left-4 px-3 py-1 bg-amber-500 text-white rounded-full text-[10px] uppercase font-bold tracking-widest shadow-lg">
                         Pending Approval
                       </div>
                    )}
                  </>
                ) : (
                  <div className="text-center space-y-4 p-8">
                    <div className="w-20 h-20 bg-sage-light/50 rounded-full flex items-center justify-center mx-auto text-sage relative">
                      {uploading ? (
                        <>
                          <Loader2 size={32} className="animate-spin" />
                          <span className="absolute inset-x-0 -bottom-8 text-[10px] font-bold text-sage">{uploadProgress}%</span>
                        </>
                      ) : <Upload size={32} />}
                    </div>
                    <div>
                      <p className="text-stone font-semibold">Click here to add your photo</p>
                      <p className="text-[10px] text-stone-light uppercase tracking-wider mt-1 opacity-60">High resolution landscapes work best</p>
                    </div>
                  </div>
                )}
                
                <input 
                  type="file"
                  ref={fileInputRef}
                  onChange={handlePhotoUpload}
                  accept="image/*"
                  className="hidden"
                />
              </div>
            </div>
          </section>

          <section>
                            <label className="block text-[10px] uppercase font-bold text-stone-light">Member Access (UIDs)</label>
            <input 
              type="text" 
              placeholder="Paste user UIDs here, separated by commas..."
              value={formData.memberUids?.join(', ')}
              onChange={(e) => setFormData({ ...formData, memberUids: (e.target.value ?? '').split(',').map(s => s.trim()).filter(Boolean) })}
              className="w-full p-4 bg-white border border-stone-border rounded-xl outline-none focus:ring-4 focus:ring-sage/5 text-xs font-mono"
            />
            <p className="mt-2 text-[9px] text-stone-light uppercase tracking-wider">Linking a UID allows that member to edit this family entry from their dashboard.</p>
          </section>

          <div className="flex flex-col sm:flex-row gap-4 pt-6">
            <button 
              type="submit" 
              disabled={isSaving || uploading}
              className="flex-1 py-5 bg-terracotta text-white rounded-2xl font-bold hover:brightness-110 shadow-lg shadow-terracotta/10 transition-all uppercase tracking-widest text-xs disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              id="save-family-btn"
            >
              {isSaving ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  Saving...
                </>
              ) : "Save Family Details"}
            </button>
            <button 
              type="button" 
              onClick={onClose}
              className="px-10 py-5 border border-stone-border text-stone-light rounded-2xl font-bold hover:bg-white transition-all uppercase tracking-widest text-xs"
              id="cancel-family-btn"
            >
              Cancel
            </button>
          </div>
        </form>
      </motion.div>
    </div>
  );
}
