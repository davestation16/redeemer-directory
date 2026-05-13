import React, { useState, useEffect } from 'react';
import { db, storage, handleFirestoreError, OperationType } from '../lib/firebase';
import { collection, query, where, onSnapshot, doc, updateDoc, deleteDoc, addDoc, serverTimestamp, orderBy, writeBatch } from 'firebase/firestore';
import { ref, deleteObject, uploadBytes, getDownloadURL } from 'firebase/storage';
import { Family, Invite, InviteCode, PhotoStatus, AccessRequest, FamilyMemberRole, FamilyMember } from '../types';
import { useAuth } from '../hooks/useAuth';
import { X, Check, Trash2, Key, Users, Image as ImageIcon, Plus, ArrowLeft, ExternalLink, Database, Inbox, UserCheck, UserX, Mail, Download, Menu, ChevronDown, AlertTriangle, Search } from 'lucide-react';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'motion/react';
import BulkImport from '../components/BulkImport';

interface AdminDashboardProps {
  onClose: () => void;
}

export default function AdminDashboard({ onClose }: AdminDashboardProps) {
  const [activeTab, setActiveTab] = useState<'invites' | 'directory' | 'photos' | 'import' | 'requests' | 'admins' | 'cleanup'>('invites');
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isCreatingFamily, setIsCreatingFamily] = useState(false);
  const [manualFamilyForm, setManualFamilyForm] = useState({
    familyName: '',
    weddingAnniversary: '',
    photo: null as File | null,
    members: [
      { name: '', role: 'Primary Adult' as FamilyMemberRole, email: '', phone: '', birthday: '' }
    ]
  });
  const [invites, setInvites] = useState<Invite[]>([]);
  const [inviteCodes, setInviteCodes] = useState<InviteCode[]>([]);
  const [families, setFamilies] = useState<Family[]>([]);
  const [requests, setRequests] = useState<AccessRequest[]>([]);
  const [allUsers, setAllUsers] = useState<any[]>([]);
  
  const pendingPhotos = families.filter(f => f.photoStatus === 'pending');
  
  // New Family Invite State
  const [inviteForm, setInviteForm] = useState({
    familyName: '',
    emails: ['']
  });
  
  const [loading, setLoading] = useState(true);
  const [lastInvite, setLastInvite] = useState<{ familyName: string, emails: string[], code: string } | null>(null);

  useEffect(() => {
    // Fetch invites
    const invitesUnsub = onSnapshot(query(collection(db, 'invites'), orderBy('createdAt', 'desc')), (snapshot) => {
      setInvites(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Invite)));
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'invites');
    });

    const inviteCodesUnsub = onSnapshot(query(collection(db, 'invite_codes'), orderBy('createdAt', 'desc')), (snapshot) => {
      setInviteCodes(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as InviteCode)));
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'invite_codes');
    });

    // Fetch all families for directory and photo management
    const familiesUnsub = onSnapshot(query(collection(db, 'families'), orderBy('familyName', 'asc')), (snapshot) => {
      setFamilies(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Family)));
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'families');
    });

    // Fetch pending requests
    const requestsUnsub = onSnapshot(query(collection(db, 'requests'), orderBy('createdAt', 'desc')), (snapshot) => {
      setRequests(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as AccessRequest)));
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'requests');
    });

    // Fetch all users for admin management
    const usersUnsub = onSnapshot(query(collection(db, 'users'), orderBy('email', 'asc')), (snapshot) => {
      setAllUsers(snapshot.docs.map(d => ({ id: d.id, ...d.data() })));
    }, (error) => {
      console.error("Users fetch error:", error);
    });

    setLoading(false);
    return () => {
      invitesUnsub();
      inviteCodesUnsub();
      familiesUnsub();
      requestsUnsub();
      usersUnsub();
    };
  }, []);

  const { isAdmin: currentUserIsAdmin } = useAuth();

  const toggleUserRole = async (userToUpdate: any) => {
    if (!currentUserIsAdmin) {
      toast.error("You do not have permission to manage admin roles.");
      return;
    }

    const newRole = userToUpdate.role === 'admin' ? 'member' : 'admin';
    
    // Safety check for primary admin
    if (userToUpdate.email === 'davedotgordon@gmail.com' && newRole === 'member') {
      toast.error("Primary root admin role cannot be revoked.");
      return;
    }

    try {
      await updateDoc(doc(db, 'users', userToUpdate.id), {
        role: newRole,
        updatedAt: serverTimestamp()
      });
      toast.success(`User role updated to ${newRole}`);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `users/${userToUpdate.id}`);
      toast.error("Failed to update user role. You must be an admin.");
    }
  };

  const [conflicts, setConflicts] = useState<any[]>([]);

  useEffect(() => {
    // Fetch conflicts
    const conflictsUnsub = onSnapshot(query(collection(db, 'system_logs'), where('type', '==', 'onboarding_conflict'), orderBy('timestamp', 'desc')), (snapshot) => {
      setConflicts(snapshot.docs.map(d => ({ id: d.id, ...d.data() })));
    }, (error) => {
      console.error("Conflicts fetch error:", error);
    });

    return () => {
      conflictsUnsub();
    };
  }, []);

  const resolveConflict = async (id: string) => {
    try {
      await updateDoc(doc(db, 'system_logs', id), { resolved: true });
      toast.success("Conflict marked as resolved");
    } catch (error) {
      toast.error("Failed to resolve conflict");
    }
  };

  const getUnregisteredMembers = () => {
    const unregistered: { familyName: string, member: any }[] = [];
    families.forEach(family => {
      family.members?.forEach(member => {
        if (member.email) {
          const email = member.email.toLowerCase().trim();
          const hasAccount = allUsers.some(u => u.email?.toLowerCase().trim() === email);
          if (!hasAccount) {
            unregistered.push({ familyName: family.familyName, member });
          }
        }
      });
    });
    return unregistered;
  };

  const unregisteredMembers = getUnregisteredMembers();

  const [confirmingRevoke, setConfirmingRevoke] = useState<string | null>(null);

  const deleteCode = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'invite_codes', id));
      toast.success("Invite code revoked");
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `invite_codes/${id}`);
    }
  };

  const handleManualFamilySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualFamilyForm.familyName.trim()) {
      toast.error("Family name is required");
      return;
    }

    setLoading(true);
    try {
      const familyRef = doc(collection(db, "families"));
      let photoUrl = null;

      // 1. Handle Photo Upload
      if (manualFamilyForm.photo) {
        const storageRef = ref(storage, `families/${familyRef.id}/photo`);
        const snapshot = await uploadBytes(storageRef, manualFamilyForm.photo);
        photoUrl = await getDownloadURL(snapshot.ref);
      }

      // 2. Create Family Doc
      const newFamily: Partial<Family> = {
        familyName: manualFamilyForm.familyName.trim(),
        weddingAnniversary: manualFamilyForm.weddingAnniversary,
        photoUrl,
        photoStatus: 'approved',
        members: manualFamilyForm.members.filter(m => m.name.trim()),
        memberUids: [],
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      };

      await writeBatch(db).set(familyRef, newFamily).commit();
      
      toast.success("Family created successfully!");
      setIsCreatingFamily(false);
      setManualFamilyForm({
        familyName: '',
        weddingAnniversary: '',
        photo: null,
        members: [{ name: '', role: 'Primary Adult', email: '', phone: '', birthday: '' }]
      });

      // Offer to generate invite link
      const code = generateInviteCode(6);
      setLastInvite({
        familyName: newFamily.familyName!,
        emails: newFamily.members!.filter(m => m.email).map(m => m.email!),
        code
      });
      
      // Save the invite code
      await addDoc(collection(db, "invite_codes"), {
        code,
        familyId: familyRef.id,
        familyName: newFamily.familyName,
        maxUses: 10,
        usedCount: 0,
        invitedEmails: newFamily.members!.filter(m => m.email).map(m => m.email!),
        createdAt: serverTimestamp(),
        status: "active"
      });

    } catch (error) {
      console.error(error);
      handleFirestoreError(error, OperationType.WRITE, 'families/manual_create');
      toast.error("Failed to create family");
    } finally {
      setLoading(false);
    }
  };

  const addManualMember = () => setManualFamilyForm(prev => ({
    ...prev,
    members: [...prev.members, { name: '', role: 'Child', email: '', phone: '', birthday: '' }]
  }));

  const removeManualMember = (index: number) => setManualFamilyForm(prev => ({
    ...prev,
    members: prev.members.filter((_, i) => i !== index)
  }));

  const updateManualMember = (index: number, field: keyof FamilyMember, value: string) => {
    const newMembers = [...manualFamilyForm.members];
    newMembers[index] = { ...newMembers[index], [field]: value };
    setManualFamilyForm(prev => ({ ...prev, members: newMembers }));
  };

  const handleRevokeClick = (id: string) => {
    if (confirmingRevoke === id) {
      deleteCode(id);
      setConfirmingRevoke(null);
    } else {
      setConfirmingRevoke(id);
      setTimeout(() => setConfirmingRevoke(null), 3000);
    }
  };

  const generateInviteCode = (length = 6) => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Avoid ambiguous characters
    let result = '';
    for (let i = 0; i < length; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  };

  const handleFamilyInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteForm.familyName.trim() || inviteForm.emails.some(e => !e.trim())) {
      toast.error("Please fill in family name and at least one email.");
      return;
    }

    setLoading(true);
    try {
      const batch = writeBatch(db);
      const code = generateInviteCode(6);
      
      // 1. Create Family Document
      const familyRef = doc(collection(db, "families"));
      batch.set(familyRef, {
        familyName: inviteForm.familyName.trim(),
        members: [{
          name: inviteForm.familyName.trim(), // Placeholder
          email: inviteForm.emails[0],
          role: "Primary Adult"
        }],
        photoStatus: "pending_invite",
        initialMagicLink: `https://directory.redeemeratl.org/invite?code=${code}`,
        memberUids: [],
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });

      // 2. Create Invite Code Document
      const inviteRef = doc(collection(db, "invite_codes"));
      batch.set(inviteRef, {
        code,
        familyId: familyRef.id,
        familyName: inviteForm.familyName.trim(),
        maxUses: 10,
        usedCount: 0,
        invitedEmails: inviteForm.emails.filter(e => e.trim()),
        createdAt: serverTimestamp(),
        status: "active"
      });

      await batch.commit();
      setLastInvite({ 
        familyName: inviteForm.familyName.trim(), 
        emails: inviteForm.emails.filter(e => e.trim()), 
        code 
      });
      toast.success(`Invite created! Code: ${code}`);
      setInviteForm({ familyName: '', emails: [''] });
    } catch (error) {
      console.error(error);
      handleFirestoreError(error, OperationType.WRITE, 'families/invite_batch');
      toast.error("Failed to create invite");
    } finally {
      setLoading(false);
    }
  };

  const addEmail = () => setInviteForm(prev => ({ ...prev, emails: [...prev.emails, ''] }));
  const removeEmail = (index: number) => setInviteForm(prev => ({ ...prev, emails: prev.emails.filter((_, i) => i !== index) }));
  const updateEmail = (index: number, value: string) => {
    const newEmails = [...inviteForm.emails];
    newEmails[index] = value;
    setInviteForm(prev => ({ ...prev, emails: newEmails }));
  };

  const handleRequestAction = async (requestId: string, status: 'approved' | 'rejected') => {
    try {
      let generatedCode = null;
      if (status === 'approved') {
        generatedCode = generateInviteCode(6);
        // Create an invite for them
        await addDoc(collection(db, 'invites'), {
          code: generatedCode,
          used: false,
          note: `Requested by ${requests.find(r => r.id === requestId)?.name}`,
          createdAt: serverTimestamp(),
        });
        toast.success(`Request approved! Code generated: ${generatedCode}`);
      }
      
      await updateDoc(doc(db, 'requests', requestId), {
        status,
        approvedCode: generatedCode,
        updatedAt: serverTimestamp()
      });

      if (status === 'rejected') {
        toast.error("Request rejected");
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `requests/${requestId}`);
      toast.error("Action failed");
    }
  };

  const handleExportRollout = () => {
    const headers = ['Family Name', 'Primary Emails', 'Magic Link'];
    const rows = families.map(f => {
      const emails = f.members?.filter(m => m.email).map(m => m.email).join(', ');
      return [
        f.familyName,
        emails || 'NO EMAIL ON FILE',
        f.initialMagicLink || 'NO LINK GENERATED'
      ];
    });

    // Sort so families without emails are at the top (highlighted/grouped)
    const sortedRows = [...rows].sort((a, b) => {
      if (a[1] === 'NO EMAIL ON FILE' && b[1] !== 'NO EMAIL ON FILE') return -1;
      if (a[1] !== 'NO EMAIL ON FILE' && b[1] === 'NO EMAIL ON FILE') return 1;
      return 0;
    });

    const csvContent = [
      headers.join(','),
      ...sortedRows.map(r => r.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `Redeemer_Directory_Rollout_${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast.success("Rollout list exported successfully");
  };

  const handlePhotoAction = async (familyId: string, status: PhotoStatus) => {
    try {
      if (status === 'approved') {
        await updateDoc(doc(db, 'families', familyId), {
          photoStatus: status,
          updatedAt: serverTimestamp()
        });
        toast.success("Photo approved successfully");
      } else {
        // 1. Delete from Storage
        try {
          // Based on MyFamilyDashboard, photos are stored at: families/{familyId}/photo
          const storageRef = ref(storage, `families/${familyId}/photo`);
          await deleteObject(storageRef);
        } catch (storageError) {
          console.error("Storage deletion error:", storageError);
          // If the file doesn't exist, we still want to clean up the Firestore record
        }

        // 2. Update Firestore
        await updateDoc(doc(db, 'families', familyId), {
          photoUrl: null,
          photoStatus: null,
          updatedAt: serverTimestamp()
        });
        
        toast.success("Photo rejected and removed from storage");
      }
    } catch (error) {
      console.error("Photo action error:", error);
      handleFirestoreError(error, OperationType.UPDATE, `families/${familyId}`);
      toast.error(`Action failed: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  };

  const [confirmingInviteDelete, setConfirmingInviteDelete] = useState<string | null>(null);

  const deleteInvite = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'invites', id));
      toast.success("Invite deleted");
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `invites/${id}`);
    }
  };

  const handleInviteDeleteClick = (id: string) => {
    if (confirmingInviteDelete === id) {
      deleteInvite(id);
      setConfirmingInviteDelete(null);
    } else {
      setConfirmingInviteDelete(id);
      setTimeout(() => setConfirmingInviteDelete(null), 3000);
    }
  };

  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);

  const deleteFamily = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'families', id));
      toast.success("Family removed");
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `families/${id}`);
      toast.error("Failed to remove family");
    }
  };

  const handleFamilyDeleteClick = (id: string) => {
    if (confirmingDelete === id) {
      deleteFamily(id);
      setConfirmingDelete(null);
    } else {
      setConfirmingDelete(id);
      setTimeout(() => setConfirmingDelete(null), 3000);
    }
  };

  const openInviteEmail = (familyName: string, emails: string[], code: string) => {
    const subject = encodeURIComponent('Your Invitation to the Redeemer Directory');
    const body = encodeURIComponent(
      `Hello! You've been invited to join the new, secure Redeemer Directory. To set up your family's profile and manage your contact information, please click the secure magic link below to create your login. You can share this link with other adults or teens in your household so they can create their own logins as well.\n\nhttps://directory.redeemeratl.org/invite?code=${code}`
    );
    window.location.href = `mailto:${emails.join(',')}?subject=${subject}&body=${body}`;
  };

  return (
    <div className="fixed inset-0 bg-stone/40 backdrop-blur-md z-[60] flex flex-col">
      <div className="flex-1 bg-bg-natural mt-12 rounded-t-[3rem] shadow-2xl flex flex-col overflow-hidden">
        {/* Dashboard Header */}
        <header className="p-6 md:p-8 border-b border-stone-border flex flex-col lg:flex-row lg:items-center justify-between gap-6">
          <div className="flex items-center gap-4 md:gap-6">
            <button 
              onClick={onClose}
              className="p-2 md:p-3 hover:bg-stone-border rounded-full transition-all text-stone-light hover:text-stone"
            >
              <ArrowLeft size={24} />
            </button>
            <h1 className="text-2xl md:text-3xl font-serif text-stone">Admin Control Panel</h1>
          </div>
          
          <div className="relative w-full lg:w-auto">
            {/* Mobile Dropdown Header */}
            <button 
              onClick={() => setIsMenuOpen(!isMenuOpen)}
              className="lg:hidden flex items-center justify-between w-full p-4 bg-stone-border/50 rounded-2xl text-stone font-bold uppercase tracking-widest text-[10px] hover:bg-stone-border transition-colors"
            >
              <div className="flex items-center gap-3">
                <span className="p-1.5 bg-sage/10 text-sage rounded-lg">
                  {activeTab === 'invites' && <Key size={14} />}
                  {activeTab === 'directory' && <Users size={14} />}
                  {activeTab === 'photos' && <ImageIcon size={14} />}
                  {activeTab === 'import' && <Database size={14} />}
                  {activeTab === 'requests' && <Inbox size={14} />}
                  {activeTab === 'admins' && <UserCheck size={14} />}
                  {activeTab === 'cleanup' && <AlertTriangle size={14} />}
                </span>
                <span>{activeTab === 'import' ? 'Bulk Import' : activeTab === 'admins' ? 'Manage Admins' : activeTab === 'cleanup' ? 'System Clean-up' : activeTab}</span>
              </div>
              <ChevronDown size={18} className={`transition-transform duration-300 ${isMenuOpen ? 'rotate-180' : ''}`} />
            </button>

            {/* Navigation Grid (Hidden on Mobile unless Open, 2 Rows on Desktop) */}
            <nav className={`
              ${isMenuOpen ? 'flex' : 'hidden'} 
              lg:grid lg:grid-cols-4 lg:gap-1.5
              absolute lg:relative top-full lg:top-auto left-0 right-0 mt-2 lg:mt-0 
              bg-stone-border p-1 rounded-2xl shadow-xl lg:shadow-none z-50 lg:z-auto
              flex-col gap-1
            `}>
              {(['invites', 'directory', 'photos', 'import', 'requests', 'admins', 'cleanup'] as const).map(tab => (
                <button
                  key={tab}
                  onClick={() => {
                    setActiveTab(tab);
                    setIsMenuOpen(false);
                  }}
                  className={`px-4 py-2.5 rounded-xl text-[10px] font-bold uppercase tracking-widest transition-all flex items-center gap-2 min-w-[140px] ${
                    activeTab === tab 
                      ? 'bg-white text-sage shadow-sm' 
                      : 'text-stone-light hover:text-stone hover:bg-white/20'
                  }`}
                >
                  <span className={`${activeTab === tab ? 'text-sage' : 'text-stone-light'}`}>
                    {tab === 'invites' && <Key size={14} />}
                    {tab === 'directory' && <Users size={14} />}
                    {tab === 'photos' && <ImageIcon size={14} />}
                    {tab === 'import' && <Database size={14} />}
                    {tab === 'requests' && <Inbox size={14} />}
                    {tab === 'admins' && <UserCheck size={14} />}
                    {tab === 'cleanup' && <AlertTriangle size={14} />}
                  </span>
                  <span className="flex-1 text-left truncate px-1">
                    {tab === 'import' ? 'Bulk Import' : tab === 'admins' ? 'Manage Admins' : tab === 'cleanup' ? 'Clean-up' : tab}
                  </span>
                  {tab === 'photos' && pendingPhotos.length > 0 && (
                    <span className="ml-auto bg-terracotta text-white text-[10px] px-1.5 py-0.5 rounded-full">{pendingPhotos.length}</span>
                  )}
                  {tab === 'requests' && requests.filter(r => r.status === 'pending').length > 0 && (
                    <span className="ml-auto bg-sage text-white text-[10px] px-1.5 py-0.5 rounded-full">{requests.filter(r => r.status === 'pending').length}</span>
                  )}
                </button>
              ))}
            </nav>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-12">
          <AnimatePresence mode="wait">
            {activeTab === 'invites' && (
              <motion.div 
                key="invites"
                initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}
                className="max-w-4xl mx-auto space-y-12 pb-20"
              >
                <div className="bg-white p-10 rounded-[2.5rem] shadow-card border border-stone-border overflow-hidden relative">
                  <div className="absolute top-0 right-0 p-8 opacity-5">
                    <Key size={120} />
                  </div>
                  
                  <div className="relative z-10 space-y-8">
                    <div>
                      <h3 className="text-2xl font-serif text-stone mb-2">Invite a New Family</h3>
                      <p className="text-sm text-stone-light">Create a directory entry and generate a secure access code for a household.</p>
                    </div>

                    <form onSubmit={handleFamilyInvite} className="space-y-6">
                      <div className="space-y-2">
                        <label className="block text-[10px] uppercase tracking-widest font-bold text-stone-light">Family Name</label>
                        <input 
                          type="text" 
                          placeholder="e.g. The Miller Family"
                          value={inviteForm.familyName}
                          onChange={(e) => setInviteForm({ ...inviteForm, familyName: e.target.value })}
                          className="w-full p-4 bg-gray-50 border border-stone-border rounded-2xl focus:ring-4 focus:ring-sage/5 outline-none transition-all"
                          required
                        />
                      </div>

                      <div className="space-y-4">
                        <div className="flex justify-between items-center">
                          <label className="block text-[10px] uppercase tracking-widest font-bold text-stone-light">Authorized Emails</label>
                          <button 
                            type="button" 
                            onClick={addEmail}
                            className="text-[10px] uppercase font-bold text-sage hover:text-stone transition-colors flex items-center gap-1"
                          >
                            <Plus size={12} /> Add Adult
                          </button>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          {inviteForm.emails.map((email, i) => (
                            <div key={i} className="relative group">
                              <input 
                                type="email" 
                                placeholder="Adult Email Address"
                                value={email}
                                onChange={(e) => updateEmail(i, e.target.value)}
                                className="w-full pl-4 pr-12 py-4 bg-gray-50 border border-stone-border rounded-2xl focus:ring-4 focus:ring-sage/5 outline-none transition-all"
                                required
                              />
                              {inviteForm.emails.length > 1 && (
                                <button 
                                  type="button"
                                  onClick={() => removeEmail(i)}
                                  className="absolute right-4 top-1/2 -translate-y-1/2 text-stone-light hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all"
                                >
                                  <Trash2 size={16} />
                                </button>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className="pt-6">
                        <button 
                          type="submit"
                          disabled={loading}
                          className="w-full py-5 bg-sage text-white rounded-2xl font-bold uppercase tracking-widest text-xs hover:brightness-110 shadow-xl shadow-sage/10 transition-all flex items-center justify-center gap-3 disabled:opacity-50"
                        >
                          {loading ? "Processing..." : "Generate Family Invite Code"}
                        </button>
                      </div>
                    </form>

                    <AnimatePresence>
                      {lastInvite && (
                        <motion.div 
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: 'auto' }}
                          exit={{ opacity: 0, height: 0 }}
                          className="pt-8 border-t border-stone-border mt-8"
                        >
                          <div className="bg-sage/5 border border-sage/20 rounded-3xl p-8 flex flex-col md:flex-row items-center justify-between gap-6">
                            <div className="flex items-center gap-4">
                              <div className="p-3 bg-sage/10 text-sage rounded-full">
                                <Mail size={24} />
                              </div>
                              <div>
                                <p className="font-bold text-stone">Invite generated for {lastInvite.familyName}</p>
                                <p className="text-xs text-stone-light">Code: <span className="font-mono font-bold text-sage">{lastInvite.code}</span></p>
                              </div>
                            </div>
                            
                            <button 
                              onClick={() => openInviteEmail(lastInvite.familyName, lastInvite.emails, lastInvite.code)}
                              className="bg-white text-sage border border-sage/30 px-8 py-4 rounded-full font-bold uppercase tracking-widest text-[10px] hover:bg-sage hover:text-white transition-all flex items-center gap-2 shadow-sm"
                            >
                              Send Invitation Email <ExternalLink size={14} />
                            </button>
                            
                            <button 
                              onClick={() => setLastInvite(null)}
                              className="text-stone-light hover:text-stone text-[10px] uppercase font-bold tracking-widest"
                            >
                              Dismiss
                            </button>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                </div>

                <div className="space-y-6">
                  <div className="flex justify-between items-end">
                    <h3 className="text-2xl font-serif text-stone">Historical Activity</h3>
                    <p className="text-[10px] uppercase tracking-widest font-bold text-stone-light">Showing all generated codes</p>
                  </div>
                  <div className="grid grid-cols-1 gap-4">
                    {inviteCodes.map(invite => (
                      <div key={invite.id} className="bg-white p-6 rounded-2xl border border-stone-border flex items-center justify-between group hover:border-sage/30 transition-all">
                        <div className="flex items-center gap-6">
                          <div className={`p-3 rounded-xl ${invite.status === 'revoked' ? 'bg-gray-100 text-gray-400' : 'bg-sage/10 text-sage'}`}>
                            <Key size={20} />
                          </div>
                          <div>
                            <div className="flex items-center gap-3">
                              <p className={`font-mono font-bold text-xl tracking-[0.2em] ${invite.status === 'revoked' ? 'line-through text-gray-400' : 'text-stone'}`}>
                                {invite.code}
                              </p>
                              {invite.usedCount > 0 && <span className="text-[10px] bg-sage/10 text-sage px-2 py-0.5 rounded-full font-bold">{invite.usedCount} Uses</span>}
                            </div>
                            <div className="flex items-center gap-2 mt-1">
                              <p className="text-[10px] uppercase text-stone-light font-bold">
                                {invite.familyName} • {invite.status}
                              </p>
                              <span className="text-stone-light opacity-30 px-1">•</span>
                              <p className="text-[10px] text-stone-light font-medium italic">
                                Auth: {invite.invitedEmails.map((email, idx) => (
                                  <React.Fragment key={email}>
                                    <a href={`mailto:${email}`} className="hover:text-sage transition-colors underline decoration-stone-border/30 hover:decoration-sage/30">{email}</a>
                                    {idx < invite.invitedEmails.length - 1 ? ', ' : ''}
                                  </React.Fragment>
                                ))}
                              </p>
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                           <button 
                             onClick={() => openInviteEmail(invite.familyName, invite.invitedEmails, invite.code)}
                             className="p-3 text-sage hover:bg-sage/10 rounded-xl transition-all"
                             title="Resend Invite Email"
                           >
                             <Mail size={18} />
                           </button>
                           <button 
                            onClick={() => handleRevokeClick(invite.id)}
                            className={`p-3 rounded-xl transition-all ${
                              confirmingRevoke === invite.id 
                                ? 'bg-red-500 text-white' 
                                : 'text-stone-light hover:text-red-500 hover:bg-red-50'
                            }`}
                            title="Revoke Code"
                          >
                            {confirmingRevoke === invite.id ? <span className="text-[10px] font-bold">CONFIRM</span> : <Trash2 size={18} />}
                          </button>
                        </div>
                      </div>
                    ))}

                    {invites.map(invite => (
                      <div key={invite.id} className="bg-white p-6 rounded-2xl border border-stone-border flex items-center justify-between group hover:border-sage/30 transition-all opacity-60">
                        <div className="flex items-center gap-6">
                          <div className={`p-3 rounded-xl ${invite.used ? 'bg-gray-100 text-gray-400' : 'bg-sage/10 text-sage'}`}>
                            <Key size={20} />
                          </div>
                          <div>
                            <div className="flex items-center gap-3">
                              <p className={`font-mono font-bold text-xl tracking-[0.2em] ${invite.used ? 'line-through text-gray-400' : 'text-stone'}`}>
                                {invite.code}
                              </p>
                              {invite.used && <Check className="text-sage" size={16} />}
                            </div>
                            <div className="flex items-center gap-2 mt-1">
                              <p className="text-[10px] uppercase text-stone-light font-bold">
                                {invite.used ? `Used by ${invite.usedBy}` : 'Unused General Code'}
                              </p>
                              {invite.note && (
                                <>
                                  <span className="text-stone-light opacity-30 px-1">•</span>
                                  <p className="text-[10px] uppercase text-stone-light font-bold italic">{invite.note}</p>
                                </>
                              )}
                            </div>
                          </div>
                        </div>
                        {!invite.used && (
                          <button 
                            onClick={() => handleInviteDeleteClick(invite.id)}
                            className={`p-3 rounded-xl transition-all ${
                              confirmingInviteDelete === invite.id 
                                ? 'bg-red-500 text-white' 
                                : 'text-stone-light hover:text-red-500 hover:bg-red-50'
                            }`}
                          >
                            {confirmingInviteDelete === invite.id ? <span className="text-[10px] font-bold">CONFIRM</span> : <Trash2 size={18} />}
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </motion.div>
            )}

            {activeTab === 'directory' && (
              <motion.div 
                key="directory"
                initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}
                className="max-w-6xl mx-auto space-y-8 pb-24"
              >
                {!isCreatingFamily ? (
                  <>
                    <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                      <h3 className="text-3xl font-serif text-stone">Member Directory</h3>
                      <div className="flex flex-wrap gap-3">
                        <button 
                          onClick={() => setIsCreatingFamily(true)}
                          className="px-6 py-3 bg-stone text-white rounded-2xl font-bold uppercase tracking-widest text-[10px] hover:bg-stone/90 transition-all flex items-center gap-2 shadow-lg"
                        >
                          <Plus size={16} /> Create New Family
                        </button>
                        <button 
                          onClick={handleExportRollout}
                          className="px-6 py-3 bg-sage text-white rounded-2xl font-bold uppercase tracking-widest text-[10px] hover:brightness-110 transition-all flex items-center gap-2 shadow-lg shadow-sage/10"
                        >
                          <Download size={14} /> Export Rollout List
                        </button>
                      </div>
                    </div>

                    <div className="bg-white rounded-[3rem] overflow-hidden border border-stone-border shadow-card">
                      <div className="overflow-x-auto">
                        <table className="w-full text-left">
                          <thead className="bg-stone-border/50">
                            <tr>
                              <th className="p-6 text-[10px] uppercase tracking-widest font-bold text-stone-light">Family Name</th>
                              <th className="p-6 text-[10px] uppercase tracking-widest font-bold text-stone-light">Members</th>
                              <th className="p-6 text-[10px] uppercase tracking-widest font-bold text-stone-light text-right">Actions</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-stone-border">
                            {families.map(family => (
                              <tr key={family.id} className="hover:bg-sage/5 transition-colors group">
                                <td className="p-6 font-semibold text-stone">{family.familyName}</td>
                                <td className="p-6 text-sm text-stone-light">
                                  {family.members?.map(m => m.name).join(', ')}
                                </td>
                                <td className="p-6 text-right">
                                  <div className="flex flex-col sm:flex-row justify-end gap-2 transition-all">
                                    {family.initialMagicLink && (
                                      <button 
                                        onClick={() => {
                                          const url = new URL(family.initialMagicLink!);
                                          const code = url.searchParams.get('code');
                                          const emails = family.members?.filter(m => m.email).map(m => m.email!) || [];
                                          if (code) {
                                            openInviteEmail(family.familyName, emails, code);
                                          } else {
                                            toast.error("Could not find invite code in link");
                                          }
                                        }}
                                        className="font-bold text-[10px] uppercase tracking-widest px-3 py-2 rounded-lg bg-sage text-white hover:brightness-110 transition-all whitespace-nowrap flex items-center justify-center gap-2"
                                      >
                                        <Mail size={12} /> Resend
                                      </button>
                                    )}
                                    <button 
                                      onClick={() => handleFamilyDeleteClick(family.id)}
                                      className={`font-bold text-[10px] uppercase tracking-widest px-3 py-2 rounded-lg transition-all ${
                                        confirmingDelete === family.id 
                                          ? 'bg-red-500 text-white shadow-lg scale-110' 
                                          : 'bg-red-50 text-red-500 hover:bg-red-100'
                                      }`}
                                    >
                                      {confirmingDelete === family.id ? 'Confirm?' : 'Remove'}
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="bg-white p-8 md:p-12 rounded-[3.5rem] shadow-card border border-stone-border">
                    <div className="flex items-center justify-between mb-10">
                      <div className="flex items-center gap-6">
                        <button 
                          onClick={() => setIsCreatingFamily(false)}
                          className="p-4 hover:bg-stone-border rounded-full transition-all text-stone-light"
                        >
                          <ArrowLeft size={24} />
                        </button>
                        <div>
                          <h3 className="text-3xl font-serif text-stone">Manual Family Creation</h3>
                          <p className="text-stone-light text-sm mt-1">Directly add a new household to the directory.</p>
                        </div>
                      </div>
                    </div>

                    <form onSubmit={handleManualFamilySubmit} className="space-y-12">
                      {/* Core Info */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                        <div className="space-y-2">
                          <label className="block text-[10px] uppercase tracking-widest font-bold text-stone-light">Family Name (Required)</label>
                          <input 
                            type="text" 
                            placeholder="e.g. The Anderson Family"
                            value={manualFamilyForm.familyName}
                            onChange={(e) => setManualFamilyForm({ ...manualFamilyForm, familyName: e.target.value })}
                            className="w-full p-4 bg-gray-50 border border-stone-border rounded-2xl focus:ring-4 focus:ring-sage/5 outline-none transition-all"
                            required
                          />
                        </div>
                        <div className="space-y-2">
                          <label className="block text-[10px] uppercase tracking-widest font-bold text-stone-light">Wedding Anniversary</label>
                          <input 
                            type="date" 
                            value={manualFamilyForm.weddingAnniversary}
                            onChange={(e) => setManualFamilyForm({ ...manualFamilyForm, weddingAnniversary: e.target.value })}
                            className="w-full p-4 bg-gray-50 border border-stone-border rounded-2xl focus:ring-4 focus:ring-sage/5 outline-none transition-all"
                          />
                        </div>
                        <div className="md:col-span-2 space-y-2">
                          <label className="block text-[10px] uppercase tracking-widest font-bold text-stone-light">Family Photo</label>
                          <div className="relative group overflow-hidden bg-gray-50 border-2 border-dashed border-stone-border rounded-3xl p-8 text-center transition-all hover:bg-stone-border/20">
                            <input 
                              type="file" 
                              accept="image/*"
                              onChange={(e) => setManualFamilyForm({ ...manualFamilyForm, photo: e.target.files?.[0] || null })}
                              className="absolute inset-0 opacity-0 cursor-pointer"
                            />
                            {manualFamilyForm.photo ? (
                              <div className="flex items-center justify-center gap-3 text-sage font-bold">
                                <ImageIcon size={24} />
                                <span>{manualFamilyForm.photo.name}</span>
                                <button type="button" onClick={(e) => { e.stopPropagation(); setManualFamilyForm({ ...manualFamilyForm, photo: null }); }} className="text-red-500 hover:text-red-700">
                                  <X size={16} />
                                </button>
                              </div>
                            ) : (
                              <div className="space-y-2">
                                <Plus size={32} className="mx-auto text-stone-light opacity-50" />
                                <p className="text-stone-light font-bold text-xs uppercase tracking-widest">Click or drag to upload family photo</p>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Members Selection */}
                      <div className="space-y-6">
                        <div className="flex justify-between items-center pb-4 border-b border-stone-border">
                          <h4 className="text-xl font-serif text-stone">Family Members</h4>
                          <button 
                            type="button" 
                            onClick={addManualMember}
                            className="flex items-center gap-2 bg-sage text-white px-4 py-2 rounded-full font-bold uppercase tracking-widest text-[10px] hover:brightness-110 shadow-lg shadow-sage/10 transition-all"
                          >
                            <Plus size={14} /> Add Member
                          </button>
                        </div>
                        
                        <div className="space-y-4">
                          {manualFamilyForm.members.map((member, i) => (
                            <div key={i} className="p-6 md:p-8 bg-gray-50 border border-stone-border rounded-[2rem] relative group hover:border-sage/30 transition-all">
                              <button 
                                type="button" 
                                onClick={() => removeManualMember(i)}
                                className="absolute top-6 right-6 p-2 text-stone-light hover:text-red-500 transition-colors bg-white rounded-full shadow-sm md:opacity-0 group-hover:opacity-100"
                                disabled={manualFamilyForm.members.length === 1}
                              >
                                <Trash2 size={16} />
                              </button>
                              
                              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                                <div className="space-y-1.5 font-sans">
                                  <label className="text-[10px] uppercase font-bold text-stone-light tracking-widest">Full Name</label>
                                  <input 
                                    type="text" 
                                    placeholder="e.g. John Doe"
                                    value={member.name}
                                    onChange={(e) => updateManualMember(i, 'name', e.target.value)}
                                    className="w-full p-3 bg-white border border-stone-border rounded-xl focus:ring-2 focus:ring-sage/20 outline-none text-sm"
                                    required
                                  />
                                </div>
                                <div className="space-y-1.5 font-sans">
                                  <label className="text-[10px] uppercase font-bold text-stone-light tracking-widest">Role</label>
                                  <select 
                                    value={member.role}
                                    onChange={(e) => updateManualMember(i, 'role', e.target.value)}
                                    className="w-full p-3 bg-white border border-stone-border rounded-xl focus:ring-2 focus:ring-sage/20 outline-none text-sm appearance-none"
                                  >
                                    <option value="Primary Adult">Primary Adult</option>
                                    <option value="Additional Adult/Parent">Additional Adult/Parent</option>
                                    <option value="Teen">Teen</option>
                                    <option value="Child">Child</option>
                                  </select>
                                </div>
                                <div className="space-y-1.5 font-sans">
                                  <label className="text-[10px] uppercase font-bold text-stone-light tracking-widest">Email (Optional)</label>
                                  <input 
                                    type="email" 
                                    placeholder="email@example.com"
                                    value={member.email}
                                    onChange={(e) => updateManualMember(i, 'email', e.target.value)}
                                    className="w-full p-3 bg-white border border-stone-border rounded-xl focus:ring-2 focus:ring-sage/20 outline-none text-sm"
                                  />
                                </div>
                                <div className="space-y-1.5 font-sans">
                                  <label className="text-[10px] uppercase font-bold text-stone-light tracking-widest">Phone (Optional)</label>
                                  <input 
                                    type="tel" 
                                    placeholder="(555) 000-0000"
                                    value={member.phone}
                                    onChange={(e) => updateManualMember(i, 'phone', e.target.value)}
                                    className="w-full p-3 bg-white border border-stone-border rounded-xl focus:ring-2 focus:ring-sage/20 outline-none text-sm"
                                  />
                                </div>
                                <div className="space-y-1.5 font-sans">
                                  <label className="text-[10px] uppercase font-bold text-stone-light tracking-widest">Birthday</label>
                                  <input 
                                    type="date" 
                                    value={member.birthday}
                                    onChange={(e) => updateManualMember(i, 'birthday', e.target.value)}
                                    className="w-full p-3 bg-white border border-stone-border rounded-xl focus:ring-2 focus:ring-sage/20 outline-none text-sm"
                                  />
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className="pt-8 border-t border-stone-border flex flex-col sm:flex-row justify-end gap-4">
                        <button 
                          type="button" 
                          onClick={() => setIsCreatingFamily(false)}
                          className="px-8 py-4 text-stone-light hover:text-stone font-bold uppercase tracking-widest text-[10px]"
                        >
                          Cancel
                        </button>
                        <button 
                          type="submit"
                          disabled={loading}
                          className="px-10 py-4 bg-sage text-white rounded-2xl font-bold uppercase tracking-widest text-xs hover:brightness-110 shadow-xl shadow-sage/10 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                        >
                          {loading ? "Creating household..." : "Save Family to Directory"}
                        </button>
                      </div>
                    </form>
                  </div>
                )}
              </motion.div>
            )}

            {activeTab === 'photos' && (
              <motion.div 
                key="photos"
                initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}
                className="max-w-4xl mx-auto"
              >
                {pendingPhotos.length === 0 ? (
                  <div className="text-center py-20 bg-white/50 rounded-3xl border-2 border-dashed border-stone-border">
                    <ImageIcon size={48} className="mx-auto text-stone-light mb-4 opacity-30" />
                    <h3 className="text-xl font-serif text-stone">All caught up!</h3>
                    <p className="text-xs text-stone-light uppercase tracking-widest mt-2">No photos pending approval</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    {pendingPhotos.map(family => (
                      <div key={family.id} className="bg-white rounded-3xl overflow-hidden shadow-card border border-stone-border">
                        <div className="h-64 bg-stone-border relative group">
                          <img src={family.photoUrl} alt="Pending" className="w-full h-full object-cover" />
                          <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                            <a href={family.photoUrl} target="_blank" rel="noreferrer" className="text-white flex items-center gap-2 hover:underline">
                              <ExternalLink size={16} /> Full Size
                            </a>
                          </div>
                        </div>
                        <div className="p-6 space-y-4">
                          <div>
                            <p className="text-[10px] uppercase tracking-widest font-bold text-stone-light mb-1 text-center md:text-left">Family Unit</p>
                            <p className="font-serif text-xl text-stone text-center md:text-left break-words [overflow-wrap:anywhere]">The {family.familyName} Family</p>
                          </div>
                          <div className="flex flex-col sm:flex-row gap-3">
                            <button 
                              onClick={() => handlePhotoAction(family.id, 'approved')}
                              className="flex-1 py-3 bg-sage text-white rounded-xl font-bold text-[10px] uppercase tracking-widest flex items-center justify-center gap-2 hover:brightness-110 shadow-sm active:scale-95"
                            >
                              <Check size={14} /> Approve
                            </button>
                            <button 
                              onClick={() => handlePhotoAction(family.id, 'rejected')}
                              className="flex-1 py-3 border border-stone-border text-stone rounded-xl font-bold text-[10px] uppercase tracking-widest flex items-center justify-center gap-2 hover:bg-red-50 hover:text-red-500 hover:border-red-100 shadow-sm active:scale-95"
                            >
                              <X size={14} /> Reject
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </motion.div>
            )}
            {activeTab === 'import' && (
              <motion.div
                key="import"
                initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}
              >
                <BulkImport />
              </motion.div>
            )}
            {activeTab === 'requests' && (
              <motion.div 
                key="requests"
                initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}
                className="max-w-5xl mx-auto space-y-6"
              >
                <div className="bg-white rounded-3xl overflow-x-auto border border-stone-border shadow-card">
                  <table className="w-full text-left min-w-[600px]">
                    <thead className="bg-stone-border/50">
                      <tr>
                        <th className="p-6 text-[10px] uppercase tracking-widest font-bold text-stone-light">Requester</th>
                        <th className="p-6 text-[10px] uppercase tracking-widest font-bold text-stone-light">Message</th>
                        <th className="p-6 text-[10px] uppercase tracking-widest font-bold text-stone-light">Status</th>
                        <th className="p-6 text-[10px] uppercase tracking-widest font-bold text-stone-light text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-stone-border">
                      {requests.map(request => (
                        <tr key={request.id} className="hover:bg-sage/5 transition-colors group">
                          <td className="p-6">
                            <p className="font-bold text-stone">{request.name}</p>
                            <a href={`mailto:${request.email}`} className="text-xs text-stone-light hover:text-sage transition-colors">{request.email}</a>
                          </td>
                          <td className="p-6 text-sm text-stone-light max-w-xs truncate">
                            {request.message || <span className="italic opacity-50">No message</span>}
                          </td>
                          <td className="p-6">
                            <div className="flex flex-col">
                              <span className={`text-[10px] uppercase tracking-widest font-bold px-3 py-1 rounded-full w-fit ${
                                request.status === 'approved' ? 'bg-sage/10 text-sage' :
                                request.status === 'rejected' ? 'bg-red-50 text-red-500' :
                                'bg-stone-border text-stone-light'
                              }`}>
                                {request.status}
                              </span>
                              {request.status === 'approved' && request.approvedCode && (
                                <div className="mt-2 flex items-center gap-2">
                                  <span className="text-xs font-mono font-bold text-stone bg-white border border-stone-border px-2 py-0.5 rounded shadow-sm">
                                    {request.approvedCode}
                                  </span>
                                  <button 
                                    onClick={() => {
                                      const subject = encodeURIComponent('Your Redeemer Directory Invite Code');
                                      const body = encodeURIComponent(`Hi ${request.name},\n\nYour request for access to the Redeemer Directory has been approved! Use the code below to join:\n\nCode: ${request.approvedCode}\n\nYou can join here: https://directory.redeemeratl.org/invite?code=${request.approvedCode}\n\nWelcome to the directory!`);
                                      window.location.href = `mailto:${request.email}?subject=${subject}&body=${body}`;
                                    }}
                                    className="p-1.5 text-sage hover:bg-sage/10 rounded-lg transition-all"
                                    title="Send Code Email"
                                  >
                                    <Mail size={14} />
                                  </button>
                                </div>
                              )}
                            </div>
                          </td>
                          <td className="p-6 text-right">
                             {request.status === 'pending' && (
                               <div className="flex flex-col sm:flex-row justify-end gap-2">
                                 <button 
                                  onClick={() => handleRequestAction(request.id, 'approved')}
                                  className="flex-1 sm:flex-none p-3 bg-sage text-white rounded-xl hover:brightness-110 transition-all shadow-sm active:scale-95 flex items-center justify-center gap-2"
                                  title="Approve & Generate Code"
                                 >
                                  <UserCheck size={16} />
                                  <span className="sm:hidden text-[10px] font-bold uppercase tracking-widest">Approve</span>
                                 </button>
                                 <button 
                                  onClick={() => handleRequestAction(request.id, 'rejected')}
                                  className="flex-1 sm:flex-none p-3 bg-red-50 text-red-500 rounded-xl hover:bg-red-100 transition-all shadow-sm active:scale-95 flex items-center justify-center gap-2"
                                  title="Reject"
                                 >
                                  <UserX size={16} />
                                  <span className="sm:hidden text-[10px] font-bold uppercase tracking-widest">Reject</span>
                                 </button>
                               </div>
                             )}
                             {request.status !== 'pending' && (
                               <button 
                                onClick={async () => {
                                  await deleteDoc(doc(db, 'requests', request.id));
                                  toast.success("Request record deleted");
                                }}
                                className="text-stone-light hover:text-red-500 transition-colors p-2 hover:bg-red-50 rounded-lg active:scale-95"
                               >
                                <Trash2 size={16} />
                               </button>
                             )}
                          </td>
                        </tr>
                      ))}
                      {requests.length === 0 && (
                        <tr>
                          <td colSpan={4} className="p-20 text-center text-stone-light italic">
                            <Inbox size={40} className="mx-auto mb-4 opacity-20" />
                            No access requests found
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </motion.div>
            )}
            {activeTab === 'admins' && (
              <motion.div 
                key="admins"
                initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}
                className="max-w-4xl mx-auto space-y-6"
              >
                <div className="flex justify-between items-center px-2">
                   <h3 className="text-2xl font-serif text-stone">Access Control</h3>
                   <div className="p-3 bg-sage/10 text-sage rounded-2xl">
                     <UserCheck size={20} />
                   </div>
                </div>
                
                <div className="bg-white rounded-3xl overflow-hidden border border-stone-border shadow-card">
                  <div className="p-6 bg-stone-border/20 text-[10px] uppercase tracking-widest font-bold text-stone-light">
                    Directory Users
                  </div>
                  <div className="divide-y divide-stone-border">
                    {allUsers.map(u => (
                      <div key={u.id} className="p-6 flex flex-col sm:flex-row items-center justify-between gap-6 hover:bg-sage/5 transition-colors">
                        <div className="flex items-center gap-4 w-full sm:w-auto">
                           <div className={`p-3 rounded-full ${u.role === 'admin' ? 'bg-sage text-white' : 'bg-stone-border text-stone-light'}`}>
                             {u.role === 'admin' ? <UserCheck size={20} /> : <Users size={20} />}
                           </div>
                           <div className="min-w-0">
                             <p className="font-bold text-stone truncate">{u.email}</p>
                             <p className="text-[10px] uppercase tracking-widest text-stone-light font-bold">
                                Role: <span className={u.role === 'admin' ? 'text-sage' : ''}>{u.role}</span>
                             </p>
                           </div>
                        </div>
                        
                        <div className="flex items-center gap-2 w-full sm:w-auto mt-4 sm:mt-0">
                           <button
                             onClick={() => toggleUserRole(u)}
                             className={`flex-1 sm:flex-none px-6 py-3 rounded-xl font-bold text-[10px] uppercase tracking-widest transition-all shadow-sm whitespace-nowrap ${
                               u.role === 'admin' 
                                 ? 'bg-stone text-white hover:bg-stone/90' 
                                 : 'bg-sage text-white hover:brightness-110 shadow-sage/10'
                             }`}
                           >
                             {u.role === 'admin' ? 'Revoke Admin' : 'Make Admin'}
                           </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </motion.div>
            )}
            {activeTab === 'cleanup' && (
              <motion.div 
                key="cleanup"
                initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}
                className="max-w-5xl mx-auto space-y-12"
              >
                {/* Onboarding Conflicts Section */}
                {conflicts.filter(c => !c.resolved).length > 0 && (
                  <div className="space-y-6">
                    <div className="flex items-center gap-3">
                      <div className="px-3 py-1.5 bg-terracotta/10 text-terracotta rounded-full flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest">
                        <AlertTriangle size={14} /> Attention Required
                      </div>
                      <h3 className="text-2xl font-serif text-stone">Onboarding Conflicts</h3>
                    </div>
                    
                    <div className="grid grid-cols-1 gap-4">
                      {conflicts.filter(c => !c.resolved).map((conflict) => (
                        <div key={conflict.id} className="bg-white p-8 rounded-[2rem] border border-stone-border shadow-card flex flex-col md:flex-row justify-between items-center gap-6">
                          <div className="space-y-2">
                            <div className="flex items-center gap-2 mb-2">
                               <span className="px-2 py-1 bg-stone/10 text-stone rounded text-[8px] font-bold uppercase tracking-widest">Login Match</span>
                               <span className="text-sm font-bold text-stone">{conflict.email}</span>
                            </div>
                            <p className="text-xs text-stone-light leading-relaxed max-w-lg">
                              This user used an invite code for <strong>{families.find(f => f.id === conflict.inviteFamilyId)?.familyName || 'Unknown Family'}</strong>, 
                              but was automatically merged into <strong>{families.find(f => f.id === conflict.emailMatchFamilyId)?.familyName || 'Match Family'}</strong> based on their directory email.
                            </p>
                          </div>
                          <button 
                            onClick={() => resolveConflict(conflict.id)}
                            className="px-6 py-3 bg-sage/10 text-sage hover:bg-sage hover:text-white rounded-full transition-all text-[10px] font-bold uppercase tracking-widest shrink-0"
                          >
                            Mark as Reviewed
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 pt-8 border-t border-stone-border">
                  <div>
                    <h3 className="text-3xl font-serif text-stone">System Clean-up</h3>
                    <p className="text-stone-light mt-1 text-sm">Identifying directory members who haven't registered their official account yet.</p>
                  </div>
                  <div className="px-5 py-2.5 bg-terracotta/10 text-terracotta rounded-full flex items-center gap-2 text-xs font-bold uppercase tracking-widest">
                    <Users size={16} /> {unregisteredMembers.length} Unregistered
                  </div>
                </div>

                {unregisteredMembers.length === 0 ? (
                  <div className="text-center py-24 bg-white rounded-[3rem] border border-stone-border shadow-card">
                    <div className="w-20 h-20 bg-sage-light text-sage rounded-full flex items-center justify-center mx-auto mb-6">
                      <Check size={40} />
                    </div>
                    <h4 className="text-2xl font-serif text-stone mb-2">System Healthy</h4>
                    <p className="text-stone-light max-w-xs mx-auto">Everyone listed in the directory has a matching login account.</p>
                  </div>
                ) : (
                  <div className="bg-white rounded-[3rem] border border-stone-border shadow-card overflow-hidden">
                    <table className="w-full text-left">
                      <thead className="bg-stone-border/30">
                        <tr>
                          <th className="p-6 text-[10px] uppercase font-bold text-stone-light tracking-widest">Member Name</th>
                          <th className="p-6 text-[10px] uppercase font-bold text-stone-light tracking-widest">Family</th>
                          <th className="p-4 text-[10px] uppercase font-bold text-stone-light tracking-widest">Email</th>
                          <th className="p-4"></th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-stone-border">
                        {unregisteredMembers.map(({ familyName, member }, i) => (
                          <tr key={i} className="hover:bg-cream/50 transition-colors">
                            <td className="p-6 font-semibold text-stone">{member.name}</td>
                            <td className="p-6 text-sm text-stone-light font-serif italic text-lg">{familyName}</td>
                            <td className="p-6">
                              <div className="flex items-center gap-2 text-sm text-sage font-medium">
                                <Mail size={14} />
                                {member.email}
                              </div>
                            </td>
                            <td className="p-6 text-right">
                              <button 
                                onClick={() => {
                                  const subject = encodeURIComponent('Join the Redeemer Directory');
                                  const body = encodeURIComponent(`Hi ${member.name},\n\nWe noticed you are listed in our family directory but haven't created your login yet. Join us here to update your info and photo:\n\nhttps://directory.redeemeratl.org`);
                                  window.location.href = `mailto:${member.email}?subject=${subject}&body=${body}`;
                                }}
                                className="px-4 py-2 bg-sage/10 text-sage hover:bg-sage hover:text-white rounded-lg transition-all text-[10px] font-bold uppercase tracking-widest"
                              >
                                Send Nudge
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </main>
      </div>
    </div>
  );
}
