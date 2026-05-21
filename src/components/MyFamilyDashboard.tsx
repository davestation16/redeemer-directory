import React, { useState, useEffect, useRef } from 'react';
import { db, storage, auth, handleFirestoreError, OperationType, doc, updateDoc, setDoc, getDocFromServer, collection, query, where, onSnapshot, serverTimestamp, onAuthStateChanged } from '../lib/firebase';
import { ref, uploadBytesResumable, getDownloadURL } from 'firebase/storage';
import { useAuth } from '../hooks/useAuth';
import { Family, FamilyMember } from '../types';
import { Camera, MapPin, Phone, Mail, Loader2, CheckCircle2, AlertCircle, Users, Plus, X, Link, Copy, Info } from 'lucide-react';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'motion/react';
import imageCompression from 'browser-image-compression';

export default function MyFamilyDashboard() {
  const { profile, user } = useAuth();
  const [family, setFamily] = useState<Family | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [formData, setFormData] = useState({
    familyName: '',
    address: '',
    weddingAnniversary: '',
    members: [] as FamilyMember[],
  });
  const [inviteCode, setInviteCode] = useState<string | null>(null);
  const [fetchingCode, setFetchingCode] = useState(false);
  const [showRoleInfo, setShowRoleInfo] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!family?.id) return;

    const q = query(
      collection(db, 'invite_codes'),
      where('familyId', '==', family.id),
      where('status', '==', 'active')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      if (!snapshot.empty) {
        const codeData = snapshot.docs[0].data();
        setInviteCode(codeData.code || snapshot.docs[0].id);
      } else {
        setInviteCode(null);
      }
    }, (error) => {
      console.error("Error fetching invite code:", error);
    });

    return () => unsubscribe();
  }, [family?.id]);

  const generateInviteCode = (length = 6) => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let result = '';
    for (let i = 0; i < length; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  };

  const handleGenerateInvite = async () => {
    if (!family || !user || !profile) return;

    // Security check: admin or Adult
    const isAdult = family.members.some(m => m.email?.toLowerCase() === user.email?.toLowerCase() && m.role === 'Adult');
    const isAdmin = profile.role === 'admin';

    if (!isAdmin && !isAdult) {
      toast.error("Only an Adult or Admin can generate a new invite link.");
      return;
    }

    setFetchingCode(true);
    try {
      const code = generateInviteCode(6);
      const inviteRef = doc(db, 'invite_codes', code);
      
      await setDoc(inviteRef, {
        code,
        familyId: family.id,
        familyName: family.familyName,
        status: 'active',
        maxUses: 10,
        usedCount: 0,
        invitedEmails: family.members.filter(m => m.email).map(m => m.email!),
        createdAt: serverTimestamp()
      });

      toast.success("Family invite link generated!");
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'invite_codes');
      toast.error("Failed to generate invite link");
    } finally {
      setFetchingCode(false);
    }
  };

  useEffect(() => {
    if (!user) return;

    // First check if profile already has a linked familyId
    if (profile?.familyId) {
      const unsubscribe = onSnapshot(doc(db, 'families', profile.familyId), (snapshot) => {
        if (snapshot.exists()) {
          const familyData = { id: snapshot.id, ...snapshot.data() } as Family;
          setFamily(familyData);
          setFormData({
            familyName: familyData.familyName || '',
            address: familyData.address || '',
            weddingAnniversary: familyData.weddingAnniversary || '',
            members: familyData.members || [],
          });
        } else {
          setFamily(null);
        }
        setLoading(false);
      }, (error) => {
        handleFirestoreError(error, OperationType.GET, `families/${profile.familyId}`);
        setLoading(false);
      });
      return () => unsubscribe();
    }

    // Fallback: Search for family where this user is a member
    const q = query(
      collection(db, 'families'), 
      where('memberUids', 'array-contains', user.uid)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      if (!snapshot.empty) {
        const familyData = { id: snapshot.docs[0].id, ...snapshot.docs[0].data() } as Family;
        setFamily(familyData);
        setFormData({
          familyName: familyData.familyName || '',
          address: familyData.address || '',
          weddingAnniversary: familyData.weddingAnniversary || '',
          members: familyData.members || [],
        });
      } else {
        setFamily(null);
      }
      setLoading(false);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'families');
      setLoading(false);
    });

    return () => unsubscribe();
  }, [user, profile]);

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !family) return;

    setUploading(true);
    setUploadProgress(0);

    // 1. Robust Authentication Wait
    // This ensures that even if the page just refreshed, we wait for the Firebase token to be valid.
    const ensureAuth = () => {
      return new Promise((resolve, reject) => {
        if (auth.currentUser) {
          resolve(auth.currentUser);
          return;
        }
        console.log("[UPLOAD_AUTH_WAIT]: Waiting for auth state to resolve...");
        const unsubscribe = onAuthStateChanged(auth, (user) => {
          unsubscribe();
          if (user) {
            resolve(user);
          } else {
            reject(new Error("Authentication required for upload"));
          }
        });
        // Timeout after 5 seconds
        setTimeout(() => {
          unsubscribe();
          reject(new Error("Authentication timeout - please refresh and try again"));
        }, 5000);
      });
    };

    try {
      await ensureAuth();
      const currentUser = auth.currentUser!;
      
      console.log("[UPLOAD_START]: Initiating family photo upload process", { 
        familyId: family.id, 
        fileName: file.name,
        userId: currentUser.uid,
        projectId: db.app.options.projectId
      });

      // 2. Client-side compression
      const options = {
        maxSizeMB: 1,
        maxWidthOrHeight: 1200, // Reduced from 1920 to 1200 for even faster loading
        useWebWorker: true,
        fileType: 'image/jpeg' // Force conversion to JPEG
      };

      toast.info("Optimizing image...");
      const compressedFile = await imageCompression(file, options);
      console.log("[UPLOAD_COMPRESSION]: Image compressed", { 
        originalSize: file.size, 
        compressedSize: compressedFile.size 
      });

      // 3. Upload to Storage
      const storagePath = `families/${family.id}/photo_${Date.now()}`;
      const storageRef = ref(storage, storagePath);
      
      console.log("[UPLOAD_STORAGE_ATTEMPT]: Starting storage upload", { 
        path: storagePath,
        bucket: storage.app.options.storageBucket,
        authUid: currentUser.uid
      });
      
      const uploadTask = uploadBytesResumable(storageRef, compressedFile, { contentType: 'image/jpeg' });

      uploadTask.on('state_changed', 
        (snapshot) => {
          const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
          setUploadProgress(Math.round(progress));
          console.log(`[UPLOAD_PROGRESS]: ${Math.round(progress)}%`);
        }, 
        (errorObj: any) => {
          console.error("[UPLOAD_STORAGE_ERROR]: Storage upload failed", {
            code: errorObj.code,
            message: errorObj.message,
            fullError: errorObj
          });
          handleFirestoreError(errorObj, OperationType.UPLOAD, storagePath);
          toast.error(`Photo upload failed: ${errorObj.message || "Unauthorized or Quota Exceeded"}`);
          setUploading(false);
          setUploadProgress(0);
        }, 
        async () => {
          // 4. Wait for URL and Update Firestore
          try {
            console.log("[UPLOAD_STORAGE_SUCCESS]: Upload complete, retrieving URL");
            const url = await getDownloadURL(uploadTask.snapshot.ref);
            console.log("[UPLOAD_URL_RETRIEVED]: URL obtained", { url });
            
            console.log("[UPLOAD_FIRESTORE_UPDATE_ATTEMPT]: Updating family record", {
              path: `families/${family.id}`,
              isTargetId: family.id === 'evyCtzuQzZIFvgjYlYAN',
              userId: auth.currentUser?.uid
            });
            
            // Streamlined updateDoc call per user request
            await updateDoc(doc(db, 'families', family.id), {
              photoUrl: url,
              photoStatus: 'pending'
            });
            
            console.log("[UPLOAD_COMPLETE]: Process finished successfully for family:", family.id);
            toast.success("Photo uploaded successfully! Your profile is being updated.");
          } catch (error: any) {
            console.error("[UPLOAD_FIRESTORE_ERROR]: Failed to update family record", {
              code: error.code,
              message: error.message,
              userId: auth.currentUser?.uid,
              path: `families/${family.id}`
            });
            handleFirestoreError(error, OperationType.UPDATE, `families/${family.id}`);
            toast.error(`Photo uploaded but failed to update database: ${error.message}`);
          } finally {
            setUploading(false);
            setUploadProgress(0);
          }
        }
      );
    } catch (error) {
      console.error("[UPLOAD_INIT_ERROR]: Could not start upload sequence", error);
      handleFirestoreError(error, OperationType.UPLOAD, `families/${family.id}/photo`);
      toast.error(`Could not start upload: ${error instanceof Error ? error.message : "Internal Error"}`);
      setUploading(false);
      setUploadProgress(0);
    }
  };

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!family) return;

    try {
      await updateDoc(doc(db, 'families', family.id), {
        familyName: formData.familyName,
        address: formData.address,
        weddingAnniversary: formData.weddingAnniversary,
        members: formData.members,
        updatedAt: serverTimestamp()
      });
      toast.success("Family details updated successfully");
    } catch (error) {
      console.error(error);
      handleFirestoreError(error, OperationType.UPDATE, `families/${family.id}`);
      toast.error("Failed to update family details");
    }
  };

  const addMember = () => {
    setFormData(prev => ({
      ...prev,
      members: [...prev.members, { name: '', role: 'Child' }]
    }));
  };

  const removeMember = (index: number) => {
    setFormData(prev => ({
      ...prev,
      members: prev.members.filter((_, i) => i !== index)
    }));
  };

  const updateMember = (index: number, field: keyof FamilyMember, value: any) => {
    const newMembers = [...formData.members];
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
            className="w-full px-3 py-3 bg-white border border-stone-border rounded-xl outline-none focus:ring-4 focus:ring-sage/5 transition-all text-xs text-stone-light appearance-none"
          >
            <option value="">Month</option>
            {months.map((m, i) => (
              <option key={m} value={(i + 1).toString().padStart(2, '0')}>{m}</option>
            ))}
          </select>
          <select 
            value={day || ''} 
            onChange={(e) => handleDayChange(e.target.value)}
            className="w-full px-3 py-3 bg-white border border-stone-border rounded-xl outline-none focus:ring-4 focus:ring-sage/5 transition-all text-xs text-stone-light appearance-none"
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

  const currentUserMember = family?.members.find(m => m.email?.toLowerCase() === user?.email?.toLowerCase());
  const isAdult = currentUserMember?.role === 'Adult' || profile?.role === 'admin';
  const isTeen = currentUserMember?.role === 'Teen';
  const canEditFamilyDetails = isAdult;

  if (!family) {
    return (
      <div className="text-center py-20 max-w-md mx-auto">
        <div className="w-20 h-20 bg-stone-border rounded-full flex items-center justify-center mx-auto mb-6">
          <AlertCircle size={40} className="text-stone-light" />
        </div>
        <h3 className="text-2xl font-serif text-stone mb-4">No Family Linked</h3>
        <p className="text-stone-light mb-8">
          Your account is not currently linked to a family unit. Please contact an administrator to be added to your family's directory entry.
        </p>
        <a 
          href="mailto:info@redeemeratl.org"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-block py-4 px-8 bg-sage text-white rounded-full font-bold uppercase tracking-widest text-xs hover:brightness-110 transition-all"
        >
          Contact Admin
        </a>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-12 pb-20">
      <div className="bg-white rounded-[3rem] shadow-card border border-stone-border overflow-hidden relative">
        {/* Progress Bar */}
        {uploading && (
          <div className="absolute top-0 left-0 w-full h-1.5 bg-darker-sage/10 z-[60] overflow-hidden">
            <motion.div 
              initial={{ width: 0 }}
              animate={{ width: `${uploadProgress}%` }}
              className="h-full bg-sage shadow-[0_0_15px_rgba(156,175,136,0.6)]"
            />
          </div>
        )}
        {/* Photo Section */}
        <div className="relative h-80 bg-gradient-to-br from-sage/20 to-stone-border/40">
          {family.photoUrl ? (
            <img 
              src={family.photoUrl} 
              alt={family.familyName} 
              className={`w-full h-full object-cover ${family.photoStatus === 'approved' ? '' : 'grayscale brightness-75'}`} 
            />
          ) : (
            <div 
              className="w-full h-full flex flex-col items-center justify-center text-center p-6 cursor-pointer group/placeholder"
              onClick={() => fileInputRef.current?.click()}
            >
              <Users size={80} className="mb-4 text-sage/20 group-hover/placeholder:scale-110 transition-transform" />
              <p className="text-sage font-serif text-2xl">The {family.familyName} Family</p>
              <p className="text-sage/60 text-xs uppercase tracking-widest font-bold mt-2">Click here to add your photo</p>
            </div>
          )}
          
          <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent flex flex-col md:flex-row items-center md:items-end justify-between p-8 md:p-12 gap-6">
            <div className="text-white text-center md:text-left w-full">
              <h1 className="text-3xl sm:text-4xl md:text-5xl lg:text-6xl font-serif mb-3 break-words [overflow-wrap:anywhere]">
                {family.members?.length === 1 
                  ? (family.members[0].name.toLowerCase().includes(family.familyName.toLowerCase()) 
                    ? family.members[0].name 
                    : `${family.members[0].name} ${family.familyName}`)
                  : `The ${family.familyName} Family`}
              </h1>
              <div className="flex items-center justify-center md:justify-start gap-2 text-xs uppercase tracking-widest font-bold opacity-80">
                  {family.photoStatus === 'approved' ? (
                    <>
                      <CheckCircle2 size={14} className="text-green-400" />
                      <span>Verified Photo</span>
                    </>
                  ) : (
                    <>
                      <Loader2 size={14} className="animate-spin" />
                      <span>Approval Pending</span>
                    </>
                  )}
                </div>
              </div>
              
              <label className="cursor-pointer bg-white/20 backdrop-blur-md hover:bg-white/30 text-white p-4 rounded-full transition-all relative group/btn shrink-0">
                <input 
                  type="file" 
                  ref={fileInputRef}
                  className="hidden" 
                  accept="image/*" 
                  onChange={handlePhotoUpload} 
                  disabled={uploading} 
                />
                {uploading ? (
                  <div className="relative flex items-center justify-center">
                    <Loader2 className="animate-spin" size={24} />
                    <span className="absolute -top-8 text-[10px] font-bold bg-black/40 px-2 py-1 rounded">{uploadProgress}%</span>
                  </div>
                ) : <Camera size={24} />}
              </label>
            </div>
          </div>

        {/* Invite System Section */}
        <div className="px-10 md:px-16 pt-10 border-b border-stone-border bg-sage/5">
          <div className="flex flex-col md:flex-row items-center justify-between gap-6 pb-10">
            <div className="flex items-start gap-4">
              <div className="p-3 bg-sage/10 text-sage rounded-full shrink-0">
                <Link size={24} />
              </div>
              <div>
                <h4 className="font-serif text-xl text-stone mb-1">Family Invite Link</h4>
                <p className="text-sm text-stone-light max-w-md leading-relaxed">
                  {inviteCode 
                    ? "Share this secure link with other adults or teens in your household so they can create their own directory logins."
                    : "Your family directory entry was created before our secure invite system. Generate a link to invite other household members."}
                </p>
              </div>
            </div>

            {inviteCode ? (
              <div className="flex items-center gap-3 w-full md:w-auto">
                <div className="flex-1 md:flex-none bg-white border border-stone-border px-4 py-3 rounded-xl font-mono text-xs text-stone truncate max-w-[240px] shadow-sm">
                  {`https://directory.redeemeratl.org/invite?code=${inviteCode}`}
                </div>
                <button 
                  type="button"
                  onClick={() => {
                    const url = `https://directory.redeemeratl.org/invite?code=${inviteCode}`;
                    navigator.clipboard.writeText(url);
                    toast.success("Invite link copied to clipboard!");
                  }}
                  className="p-3 bg-sage text-white rounded-xl hover:brightness-110 transition-all flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest shadow-lg shadow-sage/10"
                >
                  <Copy size={16} /> Copy Link
                </button>
              </div>
            ) : (
              <button 
                type="button"
                onClick={handleGenerateInvite}
                disabled={fetchingCode}
                className="w-full md:w-auto px-8 py-4 bg-sage text-white rounded-full font-bold uppercase tracking-widest text-[10px] hover:brightness-110 transition-all flex items-center justify-center gap-2 shadow-lg shadow-sage/10 disabled:opacity-50"
              >
                {fetchingCode ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
                Generate Family Invite Link
              </button>
            )}
          </div>
        </div>

        {/* Edit Form */}
        <div className="p-10 md:p-16">
          <form onSubmit={handleUpdate} className="space-y-10">
            <section className="pb-10 border-b border-stone-border grid grid-cols-1 md:grid-cols-2 gap-8">
              <div>
                <label className="block text-[10px] uppercase font-bold text-stone-light mb-2 tracking-[0.2em]">Family Identity</label>
                <input 
                  type="text" 
                  placeholder="e.g. The Miller Family"
                  value={formData.familyName}
                  onChange={(e) => setFormData({ ...formData, familyName: e.target.value })}
                  disabled={!canEditFamilyDetails}
                  className="w-full p-4 bg-white border border-stone-border rounded-xl focus:ring-4 focus:ring-sage/5 outline-none transition-all text-2xl font-serif text-stone disabled:opacity-50"
                  required
                />
              </div>
              <div>
                <MonthDayInput 
                  label="Wedding Anniversary (Optional)"
                  value={formData.weddingAnniversary}
                  onChange={(val) => canEditFamilyDetails && setFormData({ ...formData, weddingAnniversary: val })}
                />
              </div>
            </section>

            <div className="grid grid-cols-1 gap-12">
              <section className="space-y-8">
                <div className="flex justify-between items-end">
                  <div>
                    <h3 className="text-xs uppercase tracking-[0.2em] font-bold text-stone-light">Household Members</h3>
                    <p className="text-[10px] text-stone-light mt-1 uppercase tracking-wider opacity-60">Add everyone living at this address.</p>
                  </div>
                {isAdult && (
                  <button 
                    type="button" 
                    onClick={addMember}
                    className="flex items-center gap-2 px-5 py-2.5 bg-sage-light text-sage rounded-full text-[10px] uppercase font-bold hover:bg-sage hover:text-white transition-all shadow-sm"
                  >
                    <Plus size={14} /> Add Member
                  </button>
                )}
                </div>
                
                <div className="space-y-6">
                  {formData.members.map((member, i) => {
                    const isOwnProfile = member.email?.toLowerCase() === user?.email?.toLowerCase();
                    const canEditMember = isAdult || isOwnProfile;
                    
                    return (
                    <div key={i} className="p-6 bg-gray-50/50 border border-stone-border rounded-2xl space-y-4 relative group hover:border-sage/30 transition-all">
                      {(formData.members.length > 1 && isAdult) && (
                        <button 
                          type="button" 
                          onClick={() => removeMember(i)}
                          className="absolute right-4 top-4 w-9 h-9 flex items-center justify-center text-stone-light hover:text-red-500 hover:bg-red-50 transition-all rounded-full p-0"
                          title="Remove member"
                        >
                          <X size={18} />
                        </button>
                      )}
                      
                      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
                        <div className="lg:col-span-12 grid grid-cols-1 md:grid-cols-7 gap-4">
                          <div className="md:col-span-4 space-y-1">
                            <label className="text-[10px] uppercase font-bold text-stone-light tracking-widest">Name</label>
                            <input 
                              type="text" 
                              placeholder="Name" 
                              value={member.name}
                              onChange={(e) => updateMember(i, 'name', e.target.value)}
                              disabled={!isAdult}
                              className="w-full px-4 py-3 bg-white border border-stone-border rounded-xl outline-none focus:ring-4 focus:ring-sage/5 transition-all text-stone font-medium text-sm disabled:opacity-50"
                              required
                            />
                          </div>
                          <div className="md:col-span-3 space-y-1 relative">
                            <div className="flex items-center gap-1.5 mb-1">
                              <label className="text-[10px] uppercase font-bold text-stone-light tracking-widest">Role</label>
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
                                    {/* Triangle pointer */}
                                    <div className="absolute -bottom-2 left-4 w-4 h-4 bg-white border-b border-r border-stone-border rotate-45" />
                                  </motion.div>
                                </>
                              )}
                            </AnimatePresence>

                            <select
                              value={member.role}
                              onChange={(e) => {
                                const newRole = e.target.value as any;
                                const newMembers = [...formData.members];
                                newMembers[i] = { 
                                  ...newMembers[i], 
                                  role: newRole,
                                  // Clear restricted fields for children
                                  ...(newRole === 'Child' ? { email: '', phone: '' } : {})
                                };
                                setFormData(prev => ({ ...prev, members: newMembers }));
                              }}
                              disabled={!isAdult}
                              className="w-full px-4 py-3 bg-white border border-stone-border rounded-xl outline-none focus:ring-4 focus:ring-sage/5 transition-all text-stone font-medium text-sm appearance-none disabled:opacity-50"
                            >
                              <option value="Adult">Adult</option>
                              <option value="Teen">Teen</option>
                              <option value="Child">Child</option>
                            </select>
                          </div>
                        </div>

                        <div className="lg:col-span-12 grid grid-cols-1 md:grid-cols-3 gap-4 pt-3 border-t border-stone-border/30">
                          <MonthDayInput 
                            label="Birthday (Optional)"
                            value={member.birthday || ''}
                            onChange={(val) => canEditMember && updateMember(i, 'birthday', val)}
                          />
                          {member.role !== 'Child' && (
                            <>
                              <div className="space-y-1">
                                <label className="text-[10px] uppercase font-bold text-stone-light tracking-widest">Email (Optional)</label>
                                <input 
                                  type="email" 
                                  placeholder="Email" 
                                  value={member.email || ''}
                                  onChange={(e) => updateMember(i, 'email', e.target.value)}
                                  disabled={!canEditMember}
                                  className="w-full px-4 py-3 bg-white border border-stone-border rounded-xl outline-none focus:ring-4 focus:ring-sage/5 transition-all text-xs text-stone-light disabled:opacity-50"
                                />
                              </div>
                              <div className="space-y-1">
                                <label className="text-[10px] uppercase font-bold text-stone-light tracking-widest">Phone (Optional)</label>
                                <input 
                                  type="tel" 
                                  placeholder="Phone" 
                                  value={member.phone || ''}
                                  onChange={(e) => updateMember(i, 'phone', e.target.value)}
                                  disabled={!canEditMember}
                                  className="w-full px-4 py-3 bg-white border border-stone-border rounded-xl outline-none focus:ring-4 focus:ring-sage/5 transition-all text-xs text-stone-light disabled:opacity-50"
                                />
                              </div>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  )})}
                </div>
              </section>

              <section className="space-y-8 pt-10 border-t border-stone-border/50">
                <div>
                  <h3 className="text-xs uppercase tracking-[0.2em] font-bold text-stone-light">Home Address</h3>
                  <p className="text-[10px] text-stone-light mt-1 uppercase tracking-wider opacity-60">Used for the printed directory and local map.</p>
                </div>
                <div className="relative group">
                  <MapPin className="absolute left-6 top-6 text-stone-light group-focus-within:text-sage transition-colors" size={20} />
                  <textarea 
                    placeholder="Your address..." 
                    value={formData.address}
                    onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                    disabled={!canEditFamilyDetails}
                    className="w-full pl-14 pr-6 py-6 bg-gray-50/50 border border-stone-border rounded-[2.5rem] outline-none focus:ring-4 focus:ring-sage/5 transition-all h-40 resize-none font-medium text-stone disabled:opacity-50"
                  />
                </div>
              </section>
            </div>

            <div className="pt-8 border-t border-stone-border">
              <button 
                type="submit"
                className="w-full md:w-auto px-12 py-5 bg-sage text-white rounded-full font-bold uppercase tracking-widest text-xs hover:brightness-110 shadow-lg shadow-sage/10 transition-all"
              >
                Save Family Changes
              </button>
            </div>
          </form>
        </div>
      </div>

      <div className="bg-terracotta/5 border border-terracotta/20 p-8 rounded-[2rem] flex items-start gap-6">
        <div className="p-3 bg-terracotta/10 text-terracotta rounded-full">
          <AlertCircle size={24} />
        </div>
        <div>
          <h4 className="font-serif text-lg text-stone mb-1">Photo Moderation</h4>
          <p className="text-sm text-stone-light leading-relaxed">
            To ensure our directory remains a safe space for all families, new photo uploads require manual approval by our church administrators. Your new photo will appear grayscale until it's been verified.
          </p>
        </div>
      </div>
    </div>
  );
}
