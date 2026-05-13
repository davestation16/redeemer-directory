import { useState, useEffect, useMemo } from 'react';
import { db, auth } from '../lib/firebase';
import { collection, onSnapshot, query, orderBy, deleteDoc, doc } from 'firebase/firestore';
import { Family } from '../types';
import { useAuth } from '../hooks/useAuth';
import { Search, Plus, User, Users, LogOut, Phone, Mail, MapPin, Edit, Trash2, Image as ImageIcon, Menu, X, Calendar as CalendarIcon } from 'lucide-react';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'motion/react';
import FamilyForm from '../components/FamilyForm';
import { signOut } from 'firebase/auth';
import AdminDashboard from './AdminDashboard';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import MyFamilyDashboard from '../components/MyFamilyDashboard';
import { WelcomeTutorial } from '../components/WelcomeTutorial';
import Calendar from './Calendar';

export default function Directory() {
  const { profile, isAdmin, user } = useAuth();
  const navigate = useNavigate();
  const [families, setFamilies] = useState<Family[]>([]);
  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState<'directory' | 'calendar' | 'admin' | 'my-family'>('directory');
  const [isFormOpen, setIsFormOpen] = useState(false);
  const location = useLocation();

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const tab = params.get('tab');
    if (tab === 'my-family' || tab === 'calendar' || tab === 'admin' || tab === 'directory') {
      setActiveTab(tab as any);
    }
    
    // Handle specific family edit request via query param
    const editFamilyId = params.get('editFamilyId');
    if (editFamilyId && families.length > 0) {
      const familyToEdit = families.find(f => f.id === editFamilyId);
      if (familyToEdit && canEdit(familyToEdit)) {
        setEditingFamily(familyToEdit);
        setIsFormOpen(true);
      }
    }
  }, [location.search, families, isAdmin, user]);
  const [editingFamily, setEditingFamily] = useState<Family | null>(null);
  const [loading, setLoading] = useState(true);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [hideTutorial, setHideTutorial] = useState(false);

  useEffect(() => {
    if (profile?.hasSeenTutorial) {
      setHideTutorial(true);
    }
  }, [profile?.hasSeenTutorial]);

  useEffect(() => {
    // Query approved families (if not admin) or all (if admin)
    // Actually, prompt says "Fetch any family photos ... have status of pending"
    // And "approved photos ensure they are SFW before displaying"
    // So non-admins should probably only see approved photos or entries.
    // I'll keep it simple for now as requested.
    const q = query(collection(db, 'families'), orderBy('familyName', 'asc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const docs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Family));
      setFamilies(docs);
      setLoading(false);
    }, (error) => {
      console.error(error);
      toast.error("Failed to load directory. You may not have permission.");
      setLoading(false);
    });

    return unsubscribe;
  }, []);

  const filteredFamilies = useMemo(() => {
    return families.filter(f => {
      // Hide pending families from the directory grid
      if (!f.memberUids || f.memberUids.length === 0) {
        return false;
      }

      return f.familyName.toLowerCase().includes(search.toLowerCase()) ||
        f.members?.some(m => 
          m.name.toLowerCase().includes(search.toLowerCase()) ||
          m.email?.toLowerCase().includes(search.toLowerCase())
        );
    });
  }, [families, search]);

  const handleEdit = (family: Family) => {
    setEditingFamily(family);
    setIsFormOpen(true);
  };

  const handleDelete = async (id: string) => {
    if (window.confirm("Are you sure you want to delete this family entry?")) {
      try {
        await deleteDoc(doc(db, 'families', id));
        toast.success("Family deleted");
      } catch (error) {
        toast.error("Failed to delete");
      }
    }
  };

  const handleLogout = () => {
    signOut(auth);
    toast.success("Signed out");
  };

  const canEdit = (family: Family) => {
    return isAdmin || family.memberUids?.includes(user?.uid || '');
  };

  // Print functionality
  const handlePrint = () => {
    window.print();
  };

  const handleCloseForm = () => {
    setIsFormOpen(false);
    setEditingFamily(null);
    const params = new URLSearchParams(location.search);
    if (params.has('editFamilyId')) {
      params.delete('editFamilyId');
      navigate({ search: params.toString() }, { replace: true });
    }
  };

  return (
    <div className={`min-h-screen bg-bg-natural flex flex-col md:flex-row ${activeTab === 'directory' ? 'print:bg-white' : ''}`}>
      {/* Mobile Header (Only visible on small screens) */}
      <div className="md:hidden bg-sage text-white p-4 pt-[calc(1rem+env(safe-area-inset-top))] flex items-center justify-between sticky top-0 z-[60] print:hidden">
        <div className="flex items-center gap-3">
          <div className="w-12 h-auto p-2 bg-white/10 backdrop-blur-sm rounded-lg">
            <img 
              src="/logo.png" 
              alt="Redeemer Logo" 
              className="w-full h-auto brightness-0 invert opacity-90"
            />
          </div>
        </div>
        <button 
          onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
          className="p-2 hover:bg-white/10 rounded-lg transition-colors"
        >
          {isMobileMenuOpen ? <X size={24} /> : <Menu size={24} />}
        </button>
      </div>

      {/* Mobile Menu Overlay */}
      <AnimatePresence>
        {isMobileMenuOpen && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="md:hidden fixed inset-0 top-[72px] bg-sage z-50 p-8 flex flex-col print:hidden"
          >
            <nav className="space-y-6 flex-1">
              <button 
                onClick={() => { setActiveTab('directory'); setIsMobileMenuOpen(false); }}
                className={`flex items-center gap-4 text-xl font-medium w-full text-left transition-all ${activeTab === 'directory' ? 'text-white' : 'text-white/60'}`}
              >
                <User size={24} /> Redeemer Directory
              </button>
              <button 
                onClick={() => { setActiveTab('calendar'); setIsMobileMenuOpen(false); }}
                className={`flex items-center gap-4 text-xl font-medium w-full text-left transition-all ${activeTab === 'calendar' ? 'text-white' : 'text-white/60'}`}
              >
                <CalendarIcon size={24} /> Redeemer Calendar
              </button>
              <button 
                onClick={() => { setActiveTab('my-family'); setIsMobileMenuOpen(false); }}
                className={`flex items-center justify-between gap-4 text-xl font-medium w-full text-left transition-all ${activeTab === 'my-family' ? 'text-white' : 'text-white/60'}`}
              >
                <div className="flex items-center gap-4">
                  <Users size={24} /> Edit My Details
                </div>
                {!hideTutorial && (
                  <motion.div 
                    animate={{ scale: [1, 1.2, 1] }} 
                    transition={{ repeat: Infinity, duration: 1.5 }}
                    className="w-2.5 h-2.5 bg-white rounded-full shadow-[0_0_10px_white]" 
                  />
                )}
              </button>
              {isAdmin && (
                <button 
                  onClick={() => { setActiveTab('admin'); setIsMobileMenuOpen(false); }}
                  className={`flex items-center gap-4 text-xl font-medium w-full text-left transition-all ${activeTab === 'admin' ? 'text-white' : 'text-white/60'}`}
                >
                  <Edit size={24} /> Admin Panel
                </button>
              )}
              <div className="h-px bg-white/10 my-8" />
              <button 
                onClick={handleLogout}
                className="flex items-center gap-4 text-xl font-medium text-white/60 hover:text-red-200 transition-all w-full text-left"
              >
                <LogOut size={24} /> Sign Out
              </button>
            </nav>

            <div className="pt-8 border-t border-white/10">
              <p className="text-[10px] opacity-60 uppercase tracking-widest mb-1">Authenticated user</p>
              <p className="text-sm font-bold truncate">{profile?.email}</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Sidebar - Desktop (Hidden during print) */}
      <aside className="hidden md:flex w-72 bg-sage text-white p-8 pl-[calc(2rem+env(safe-area-inset-left))] flex-col justify-between shrink-0 sticky top-0 h-screen z-50 print:hidden">
        <div className="space-y-12">
          <div className="space-y-6">
            <div className="w-32 h-auto p-4 bg-white/10 backdrop-blur-sm rounded-2xl group transition-all hover:bg-white/15">
              <img 
                src="/logo.png" 
                alt="Redeemer Directory Logo" 
                className="w-full h-auto brightness-0 invert opacity-90 transition-transform group-hover:scale-105"
              />
            </div>
            <div>
              <h1 className="text-2xl font-bold leading-tight font-serif">Redeemer</h1>
              <p className="text-[10px] opacity-80 uppercase tracking-widest font-sans mt-1">Directory</p>
            </div>
          </div>
          
          <nav className="space-y-3 font-sans text-sm font-medium">
            <button 
              onClick={() => setActiveTab('directory')}
              className={`flex items-center gap-3 p-3 rounded-xl w-full text-left transition-colors ${activeTab === 'directory' ? 'bg-white/10' : 'opacity-70 hover:opacity-100'}`}
            >
              <User size={18} /> Redeemer Directory
            </button>
            <button 
              onClick={() => setActiveTab('calendar')}
              className={`flex items-center gap-3 p-3 rounded-xl w-full text-left transition-colors ${activeTab === 'calendar' ? 'bg-white/10' : 'opacity-70 hover:opacity-100'}`}
            >
              <CalendarIcon size={18} /> Calendar
            </button>
            <button 
              onClick={() => setActiveTab('my-family')}
              className={`flex items-center justify-between p-3 rounded-xl w-full text-left transition-colors relative ${activeTab === 'my-family' ? 'bg-white/10' : 'opacity-70 hover:opacity-100'}`}
            >
              <div className="flex items-center gap-3">
                <Users size={18} /> Edit My Details
              </div>
              {!hideTutorial && (
                <motion.div 
                  animate={{ scale: [1, 1.3, 1], opacity: [0.5, 1, 0.5] }} 
                  transition={{ repeat: Infinity, duration: 2 }}
                  className="w-2 h-2 bg-white rounded-full shadow-[0_0_8px_white]" 
                />
              )}
            </button>
            {isAdmin && (
              <button 
                onClick={() => setActiveTab('admin')}
                className={`flex items-center gap-3 p-3 rounded-xl w-full text-left transition-colors ${activeTab === 'admin' ? 'bg-white/10' : 'opacity-70 hover:opacity-100'}`}
              >
                <Edit size={18} /> Admin Panel
              </button>
            )}
            <button 
              onClick={handleLogout}
              className="flex items-center gap-3 p-3 opacity-70 hover:opacity-100 hover:text-red-200 transition-all w-full text-left"
            >
              <LogOut size={18} /> Sign Out
            </button>
          </nav>
        </div>

        <div className="pt-8 border-t border-white/10 mt-auto">
          <p className="text-[10px] opacity-60 uppercase tracking-widest mb-1">Authenticated user</p>
          <p className="text-xs font-bold truncate">{profile?.email}</p>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 p-6 md:p-12 pr-[calc(1.5rem+env(safe-area-inset-right))] flex flex-col min-w-0">
        <header className="flex flex-col lg:flex-row justify-between items-start lg:items-end mb-6 md:mb-12 gap-4 md:gap-8">
          <div className="space-y-2">
            <h2 className="text-4xl lg:text-5xl font-serif text-stone">
              {activeTab === 'admin' ? 'System Controls' : activeTab === 'my-family' ? 'Edit My Details' : activeTab === 'calendar' ? 'Events' : 'Redeemer Directory'}
            </h2>
          </div>
          
          <div className="flex flex-col sm:flex-row items-center gap-4 w-full lg:w-auto">
            {activeTab === 'directory' && (
              <div className="relative w-full sm:w-80 group">
                <input 
                  type="text" 
                  placeholder="Search by name..." 
                  className="w-full pl-10 pr-4 py-3 bg-white border border-stone-border rounded-full text-sm focus:outline-none focus:ring-4 focus:ring-sage/5 transition-all outline-none"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-stone-light group-focus-within:text-sage transition-colors" />
              </div>
            )}
            
            {activeTab === 'directory' && (
              <button 
                onClick={handlePrint}
                className="bg-stone text-white px-6 py-3 rounded-full font-medium hover:bg-stone/90 transition-all shadow-lg shadow-stone/5 w-full sm:w-auto flex items-center justify-center gap-2 print:hidden"
              >
                <ImageIcon size={18} /> Export to Print
              </button>
            )}
          </div>
        </header>

        {activeTab === 'admin' ? (
          <div className="flex-1 overflow-hidden">
             <AdminDashboard onClose={() => setActiveTab('directory')} />
          </div>
        ) : activeTab === 'my-family' ? (
          <div className="flex-1 overflow-y-auto">
             <MyFamilyDashboard />
          </div>
        ) : activeTab === 'calendar' ? (
          <div className="flex-1 overflow-y-auto">
             <Calendar />
          </div>
        ) : (
          <>
            {/* Standard Grid View */}
            <div className="print:hidden">
              {loading ? (
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
                  {[1,2,3,4].map(i => <div key={i} className="h-48 bg-white/50 rounded-2xl animate-pulse"></div>)}
                </div>
              ) : filteredFamilies.length > 0 ? (
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-8 overflow-y-auto pr-2 pb-12">
                  <AnimatePresence mode="popLayout">
                    {filteredFamilies.map((family) => (
                      <motion.div 
                        layout
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.95 }}
                        key={family.id} 
                        className="group"
                      >
                        <Link 
                          to={`/family/${family.id}`}
                          className="block space-y-4 text-center cursor-pointer"
                        >
                          <div className="relative aspect-[4/5] rounded-[2.5rem] overflow-hidden bg-stone-border shadow-md group-hover:shadow-xl group-hover:shadow-sage/10 group-hover:-translate-y-1 transition-all">
                            {family.photoUrl && family.photoStatus === 'approved' ? (
                              <img 
                                src={family.photoUrl} 
                                alt={family.familyName} 
                                className="w-full h-full object-cover transition-all group-hover:scale-105" 
                              />
                            ) : (
                              <div className="w-full h-full flex flex-col items-center justify-center bg-sage-light/30">
                                <Users size={32} className="text-sage opacity-20" />
                                <p className="mt-2 text-[10px] uppercase font-bold text-sage opacity-40">Awaiting Photo</p>
                              </div>
                            )}
                            
                            {isAdmin && family.photoStatus === 'pending' && (
                              <div className="absolute top-4 left-4 px-2 py-1 bg-amber-500 text-white rounded-full text-[8px] uppercase font-bold tracking-widest shadow-lg">
                                Pending
                              </div>
                            )}

                            <div className="absolute inset-0 bg-stone/20 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                              <span className="px-4 py-2 bg-white text-stone text-[10px] uppercase font-bold tracking-widest rounded-full shadow-xl translate-y-2 group-hover:translate-y-0 transition-transform">
                                View Profile
                              </span>
                            </div>
                          </div>

                          <div className="px-2">
                            <h3 className="font-serif text-lg text-stone group-hover:text-sage transition-colors leading-tight break-words [overflow-wrap:anywhere]">
                              {family.members?.length === 1 
                                ? `${family.members[0].name} ${family.familyName}` 
                                : `The ${family.familyName} Family`}
                            </h3>
                            <p className="text-[10px] uppercase font-bold text-stone-light tracking-widest opacity-60 mt-2">
                              {family.members?.length || 0} Members
                            </p>
                          </div>
                        </Link>
                      </motion.div>
                    ))}
                  </AnimatePresence>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-32 text-center bg-white/30 rounded-3xl border-2 border-dashed border-stone-border">
                  <Search size={48} className="text-stone-light mb-6 opacity-30" />
                  <h3 className="text-2xl text-stone mb-2 font-serif">A quiet place...</h3>
                  <p className="text-stone-light max-w-sm text-sm">We couldn't find any families matching your search. Please check the spelling or filters.</p>
                </div>
              )}
            </div>

            {/* Print Only View */}
            <div className="hidden print:block">
              {families.map((family) => (
                <div key={`print-${family.id}`} className="family-print-page">
                   <div className="flex justify-between items-start mb-12">
                      <div className="space-y-4">
                        <h1 className="text-5xl font-serif text-stone">
                          {family.members?.length === 1 
                            ? `${family.members[0].name} ${family.familyName}` 
                            : `The ${family.familyName} Family`}
                        </h1>
                        {family.address && (
                          <div className="flex items-center gap-2 text-stone-light">
                            <MapPin size={18} />
                            <p className="text-lg">{family.address}</p>
                          </div>
                        )}
                      </div>
                      <div className="w-24">
                        <img src="/logo.png" alt="Logo" className="w-full opacity-20 grayscale" />
                      </div>
                   </div>

                   <div className="grid grid-cols-2 gap-12">
                      <div className="aspect-[4/5] rounded-3xl overflow-hidden bg-stone-border">
                         {family.photoUrl && family.photoStatus === 'approved' ? (
                           <img 
                             src={family.photoUrl} 
                             alt={family.familyName} 
                             className="w-full h-full object-cover" 
                           />
                         ) : (
                           <div className="w-full h-full flex items-center justify-center bg-stone-border">
                             <Users size={64} className="text-stone-light opacity-50" />
                           </div>
                         )}
                      </div>

                      <div className="space-y-8">
                         <h3 className="text-2xl font-serif border-b border-stone-border pb-2">Family Members</h3>
                         <div className="space-y-6">
                            {family.members?.map((member, idx) => (
                              <div key={idx} className="space-y-1">
                                <div className="flex justify-between items-baseline">
                                  <p className="text-xl font-medium">{member.name}</p>
                                  <p className="text-xs uppercase tracking-widest text-stone-light">{member.role}</p>
                                </div>
                                <div className="space-y-0.5">
                                  {member.phone && <p className="text-sm text-stone-light">{member.phone}</p>}
                                  {member.email && <p className="text-sm text-stone-light italic">{member.email}</p>}
                                </div>
                              </div>
                            ))}
                         </div>
                      </div>
                   </div>
                </div>
              ))}
            </div>
          </>
        )}
      </main>

      {isFormOpen && (
        <FamilyForm 
          family={editingFamily} 
          onClose={handleCloseForm} 
          onSave={() => {}}
        />
      )}

      <AnimatePresence>
        {profile && !hideTutorial && (
          <WelcomeTutorial onComplete={() => {
            setHideTutorial(true);
            setActiveTab('my-family');
          }} />
        )}
      </AnimatePresence>
    </div>
  );
}
