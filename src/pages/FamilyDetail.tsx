import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { Family } from '../types';
import { ArrowLeft, MapPin, Mail, Phone, Users, Calendar, Heart, Gift, Smartphone, Edit } from 'lucide-react';
import { motion } from 'motion/react';
import { format, parseISO } from 'date-fns';
import CalendarActions from '../components/CalendarActions';
import CalendarSyncModal from '../components/CalendarSyncModal';
import { useAuth } from '../hooks/useAuth';

export default function FamilyDetail() {
  const { familyId } = useParams();
  const navigate = useNavigate();
  const { user, isAdmin } = useAuth();
  const [family, setFamily] = useState<Family | null>(null);
  const [loading, setLoading] = useState(true);

  const [isSyncModalOpen, setIsSyncModalOpen] = useState(false);

  useEffect(() => {
    async function fetchFamily() {
      if (!familyId) return;
      try {
        const docRef = doc(db, 'families', familyId);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
          setFamily({ id: docSnap.id, ...docSnap.data() } as Family);
        }
      } catch (error) {
        console.error("Error fetching family:", error);
      } finally {
        setLoading(false);
      }
    }
    fetchFamily();
  }, [familyId]);

  const canEdit = family && (isAdmin || family.memberUids?.includes(user?.uid || ''));

  const formatDisplayDate = (dateStr?: string) => {
    if (!dateStr) return null;
    try {
      // Handle YYYY-MM-DD
      const [year, month, day] = dateStr.split('-').map(Number);
      const date = new Date(year, month - 1, day);
      return format(date, 'MMMM do');
    } catch (e) {
      return dateStr;
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-stone-bg flex items-center justify-center">
        <div className="animate-pulse flex flex-col items-center gap-4">
          <div className="w-12 h-12 bg-sage/20 rounded-full" />
          <p className="text-stone-light text-xs uppercase tracking-widest font-bold">Loading family...</p>
        </div>
      </div>
    );
  }

  if (!family) {
    return (
      <div className="min-h-screen bg-stone-bg flex items-center justify-center">
        <div className="text-center space-y-4">
          <p className="text-stone font-serif text-2xl">Family not found</p>
          <button 
            onClick={() => navigate('/directory')}
            className="text-sage font-bold uppercase text-[10px] tracking-widest hover:text-stone transition-colors"
          >
            Return to Directory
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-stone-bg selection:bg-sage/10">
      {/* Header */}
      <header className="fixed top-0 left-0 right-0 z-50 bg-stone-bg/80 backdrop-blur-md border-b border-stone-border/50">
        <div className="max-w-5xl mx-auto px-6 h-auto md:h-20 py-4 md:py-0 flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center justify-between w-full md:w-auto gap-4">
            <button 
              onClick={() => navigate('/directory')}
              className="group flex items-center gap-3 text-stone-light hover:text-stone transition-all"
            >
              <div className="w-8 h-8 rounded-full border border-stone-border flex items-center justify-center group-hover:bg-sage-light group-hover:border-sage transition-all">
                <ArrowLeft size={16} />
              </div>
              <span className="text-[10px] uppercase font-bold tracking-widest hidden sm:inline">Back to Directory</span>
            </button>

            {canEdit && (
              <button 
                onClick={() => navigate('/directory?tab=my-family')} 
                className="flex md:hidden items-center gap-2 px-4 py-2 bg-sage/10 text-sage rounded-full text-[10px] font-bold uppercase tracking-widest hover:bg-sage hover:text-white transition-all"
              >
                <Edit size={14} /> Edit Profile
              </button>
            )}
          </div>

          <div className="flex items-center gap-3 w-full md:w-auto justify-center md:justify-end">
            {canEdit && (
              <button 
                onClick={() => navigate('/directory?tab=my-family')} 
                className="hidden md:flex items-center gap-2 px-4 py-2 bg-sage/10 text-sage rounded-full text-[10px] font-bold uppercase tracking-widest hover:bg-sage hover:text-white transition-all"
              >
                <Edit size={14} /> Edit Profile
              </button>
            )}
            <button 
              onClick={() => setIsSyncModalOpen(true)}
              className="flex items-center gap-2 px-4 py-2 bg-stone text-white rounded-full text-[10px] font-bold uppercase tracking-widest hover:bg-stone/90 transition-all shadow-lg shadow-stone/10"
            >
              <Smartphone size={14} /> Sync Entire Calendar
            </button>
          </div>
        </div>
      </header>

      <CalendarSyncModal isOpen={isSyncModalOpen} onClose={() => setIsSyncModalOpen(false)} />

      <main className="pt-32 pb-24 max-w-5xl mx-auto px-6">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-12 flex flex-col md:flex-row md:items-end justify-between gap-6"
        >
          <h1 className="font-serif text-4xl sm:text-5xl md:text-7xl lg:text-8xl text-stone leading-tight tracking-tight text-center md:text-left break-words [overflow-wrap:anywhere] w-full">
            The {family.familyName} Family
          </h1>
        </motion.div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 lg:gap-16">
          
          {/* Left: Photo and Quick Info */}
          <div className="lg:col-span-4 space-y-8">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.1 }}
              className="relative aspect-square rounded-[2.5rem] overflow-hidden bg-stone-border shadow-xl shadow-stone/5 ring-1 ring-stone-border"
            >
              {family.photoUrl && family.photoStatus === 'approved' ? (
                <img 
                  src={family.photoUrl} 
                  alt={family.familyName} 
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full flex flex-col items-center justify-center bg-sage-light/30">
                  <Users size={48} className="text-sage opacity-20" />
                  <p className="mt-4 text-[10px] uppercase font-bold text-sage opacity-40">
                    {family.photoStatus === 'pending' ? 'Photo Pending Approval' : 'No photo available'}
                  </p>
                </div>
              )}
            </motion.div>

            <div className="space-y-6 bg-white/50 p-8 rounded-[2.5rem] border border-stone-border/50">
              <div className="space-y-3">
                <h3 className="text-[10px] uppercase tracking-[0.2em] font-bold text-stone-light">Home Address</h3>
                <div className="flex gap-3 items-start group">
                  <MapPin size={16} className="text-sage mt-1 shrink-0" />
                  <p className="text-stone font-medium text-sm leading-relaxed">
                    {family.address || <span className="italic opacity-30 text-xs">No address on file</span>}
                  </p>
                </div>
              </div>

              {family.weddingAnniversary && (
                <div className="space-y-3 pt-6 border-t border-stone-border/50">
                  <div className="flex items-center justify-between">
                    <h3 className="text-[10px] uppercase tracking-[0.2em] font-bold text-stone-light">Wedding Anniversary</h3>
                    <CalendarActions 
                      name={`The ${family.familyName} Family`} 
                      date={family.weddingAnniversary} 
                      type="Anniversary" 
                    />
                  </div>
                  <div className="flex gap-3 items-center text-stone font-medium text-sm">
                    <Heart size={16} className="text-terracotta shrink-0" />
                    <p className="font-serif text-lg">
                      {formatDisplayDate(family.weddingAnniversary)}
                    </p>
                  </div>
                </div>
              )}

              {family.createdAt && (
                <div className="pt-6 border-t border-stone-border/50">
                  <div className="flex items-center gap-2 text-stone-light">
                    <Calendar size={12} />
                    <span className="text-[9px] uppercase font-bold tracking-widest opacity-60">Joined {format(family.createdAt.toDate(), 'MMMM yyyy')}</span>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Right: Members and Details */}
          <div className="lg:col-span-8 space-y-12">
            <div className="space-y-8">
              <div className="flex items-center justify-between">
                <h2 className="text-xs uppercase tracking-[0.2em] font-bold text-stone-light">Household Members</h2>
                <div className="h-[1px] flex-1 bg-stone-border/30 ml-6"></div>
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {family.members?.map((member, i) => (
                  <motion.div 
                    key={i}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.2 + i * 0.1 }}
                    className="group relative p-8 bg-white border border-stone-border rounded-[2.5rem] hover:border-sage/30 hover:shadow-xl hover:shadow-sage/5 transition-all flex flex-col justify-between"
                  >
                    <div className="mb-6 flex items-start justify-between">
                      <h4 className="text-xl font-serif text-stone group-hover:text-sage transition-colors leading-tight">{member.name}</h4>
                      <CalendarActions 
                        name={member.name} 
                        date={member.birthday || ''} 
                        type="Birthday" 
                      />
                    </div>

                    <div className="space-y-3 pt-4 border-t border-stone-border/20">
                      {member.birthday && (
                        <div className="flex items-center gap-3 text-stone-light text-xs font-medium">
                          <Gift size={14} className="opacity-40 text-terracotta" />
                          <span>Birthday: {formatDisplayDate(member.birthday)}</span>
                        </div>
                      )}
                      {member.email && (
                        <a href={`mailto:${member.email}`} className="flex items-center gap-3 text-stone-light text-xs font-medium hover:text-sage transition-colors truncate">
                          <Mail size={14} className="opacity-40" />
                          <span className="truncate">{member.email}</span>
                        </a>
                      )}
                      {member.phone && (
                        <a href={`tel:${member.phone}`} className="flex items-center gap-3 text-stone-light text-xs font-medium hover:text-sage transition-colors">
                          <Phone size={14} className="opacity-40" />
                          {member.phone}
                        </a>
                      )}
                      {!member.email && !member.phone && (
                        <p className="text-[10px] text-stone-light italic opacity-40">No contact info provided</p>
                      )}
                    </div>
                  </motion.div>
                ))}
              </div>
            </div>
          </div>

        </div>
      </main>
    </div>
  );
}
