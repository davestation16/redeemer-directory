import React, { useState, useEffect } from 'react';
import { auth, db, handleFirestoreError, OperationType } from '../lib/firebase';
import { signInWithEmailAndPassword, sendPasswordResetEmail, createUserWithEmailAndPassword } from 'firebase/auth';
import { collection, addDoc, serverTimestamp, query, where, getDocs, getDoc, writeBatch, doc } from 'firebase/firestore';
import { toast } from 'sonner';
import { LogIn, Mail, ArrowLeft, Key, Send, UserPlus, AlertTriangle } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useSearchParams, useNavigate } from 'react-router-dom';

type AuthView = 'home' | 'login' | 'invite' | 'request' | 'register' | 'error';

interface LoginProps {
  inviteOnly?: boolean;
}

export default function Login({ inviteOnly }: LoginProps) {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [view, setView] = useState<AuthView>('home');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [isResetMode, setIsResetMode] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  // Request form state
  const [requestForm, setRequestForm] = useState({
    name: '',
    email: '',
    message: ''
  });

  // Handle URL parameter for invite code
  useEffect(() => {
    const code = searchParams.get('code');
    if (code) {
      setInviteCode(code);
      autoVerifyCode(code);
    } else if (inviteOnly) {
      setErrorMsg("No invitation code was found in your link. Please check the URL or ask for a new invite.");
      setView('error');
    }
  }, [searchParams, inviteOnly]);

  const autoVerifyCode = async (code: string) => {
    setLoading(true);
    const sanitizedCode = code.trim().toUpperCase();
    console.log(`Auto-verifying code: ${sanitizedCode}`);

    try {
      // 1. Check legacy invites
      const q1 = query(collection(db, 'invites'), where('code', '==', sanitizedCode), where('used', '==', false));
      const snap1 = await getDocs(q1);
      
      if (!snap1.empty) {
        console.log('Auto-verify result: Found valid legacy code');
        toast.success("Invitation verified! Create your account below.");
        setView('register');
        return;
      }

      // 2. Check new family-linked invite_codes by Doc ID
      const docRef = doc(db, 'invite_codes', sanitizedCode);
      const docSnap = await getDoc(docRef);
      
      if (docSnap.exists()) {
        const data = docSnap.data();
        if (data.status === 'active' && (data.usedCount || 0) < (data.maxUses || 10)) {
          console.log('Auto-verify result: Found valid Doc ID for family code');
          toast.success("Invitation verified! Create your account below.");
          setView('register');
          return;
        }
        console.log(`Auto-verify rejection: status is ${data.status}, used ${data.usedCount}/${data.maxUses}`);
      }

      // 3. Check by 'code' field
      const q2 = query(collection(db, 'invite_codes'), where('code', '==', sanitizedCode), where('status', '==', 'active'));
      const snap2 = await getDocs(q2);
      
      if (!snap2.empty) {
        console.log('Auto-verify result: Found valid field for family code');
        toast.success("Invitation verified! Create your account below.");
        setView('register');
        return;
      }

      console.log('Auto-verify result: No valid code found');
      setErrorMsg("The invitation link is invalid or has already been used.");
      setView('error');
    } catch (error: any) {
      console.error(error);
      handleFirestoreError(error, OperationType.LIST, 'invites/verify');
      setErrorMsg("Failed to verify invite: " + error.message);
      setView('error');
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const lowerEmail = email.toLowerCase().trim();
    const sanitizedCode = inviteCode?.trim().toUpperCase();

    try {
      const userCredential = await signInWithEmailAndPassword(auth, email, password);
      const user = userCredential.user;
      
      // 1. Check if user has a profile
      const userDocRef = doc(db, 'users', user.uid);
      const userSnap = await getDoc(userDocRef);
      
      if (!userSnap.exists()) {
        console.log("No profile found for logged in user. Starting Lazy Onboarding...");
        
        // Data Mesh Search
        const familiesSnap = await getDocs(collection(db, 'families'));
        let emailMatchFamilyId = null;
        let existingMemberIndex = -1;

        for (const fDoc of familiesSnap.docs) {
          const fData = fDoc.data();
          const members = fData.members || [];
          const mIndex = members.findIndex((m: any) => m.email?.toLowerCase().trim() === lowerEmail);
          if (mIndex !== -1) {
            emailMatchFamilyId = fDoc.id;
            existingMemberIndex = mIndex;
            break;
          }
        }

        // Invite Code Resolve (if any)
        let inviteFamilyId = null;
        if (sanitizedCode) {
          const icSnap = await getDocs(query(collection(db, 'invite_codes'), where('code', '==', sanitizedCode), where('status', '==', 'active')));
          if (!icSnap.empty) {
            inviteFamilyId = icSnap.docs[0].data().familyId;
          }
        }

        const finalFamilyId = emailMatchFamilyId || inviteFamilyId;

        // Lazy Onboarding with Retry
        const completeLateOnboarding = async (retry = 0): Promise<void> => {
          try {
            const batch = writeBatch(db);
            batch.set(userDocRef, {
              uid: user.uid,
              email: lowerEmail,
              role: 'member',
              familyId: finalFamilyId,
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp()
            });

            if (finalFamilyId) {
              const famRef = doc(db, 'families', finalFamilyId);
              const famSnap = await getDoc(famRef);
              if (famSnap.exists()) {
                const famData = famSnap.data();
                let updatedMembers = [...(famData.members || [])];
                
                if (emailMatchFamilyId && existingMemberIndex !== -1) {
                  updatedMembers[existingMemberIndex] = {
                    ...updatedMembers[existingMemberIndex],
                    uid: user.uid
                  };
                } else {
                  updatedMembers.push({
                    name: lowerEmail.split('@')[0],
                    email: lowerEmail,
                    role: 'Member',
                    uid: user.uid
                  });
                }

                batch.update(famRef, {
                  memberUids: Array.from(new Set([...(famData.memberUids || []), user.uid])),
                  members: updatedMembers,
                  updatedAt: serverTimestamp()
                });
              }
            }
            await batch.commit();
          } catch (error: any) {
            if (retry === 0 && (error.code === 'permission-denied' || error.message?.includes('insufficient permissions'))) {
              console.log("Retrying late onboarding...");
              await new Promise(resolve => setTimeout(resolve, 500));
              return completeLateOnboarding(1);
            }
            throw error;
          }
        };

        await completeLateOnboarding();
        toast.success("Welcome! Profile linked to directory.");
      } else {
        toast.success("Welcome back!");
      }
    } catch (error: any) {
      toast.error(error.message || "Login failed");
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const sanitizedCode = inviteCode?.trim().toUpperCase();
    const lowerEmail = email.toLowerCase().trim();

    try {
      // 1. AUTH FIRST
      let newUser;
      try {
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        newUser = userCredential.user;
      } catch (authError: any) {
        if (authError.code === 'auth/email-already-in-use') {
          toast.info("You already have an account! Please sign in to link your directory profile.");
          setView('login');
          setLoading(false);
          return;
        }
        throw authError;
      }

      // 2. NOW AUTHENTICATED: THE DATA MESH
      let emailMatchFamilyId = null;
      let existingMemberIndex = -1;
      
      const familiesSnap = await getDocs(collection(db, 'families'));
      for (const fDoc of familiesSnap.docs) {
        const fData = fDoc.data();
        const members = fData.members || [];
        const mIndex = members.findIndex((m: any) => m.email?.toLowerCase().trim() === lowerEmail);
        if (mIndex !== -1) {
          emailMatchFamilyId = fDoc.id;
          existingMemberIndex = mIndex;
          break;
        }
      }

      // 3. Resolve Invite Data
      let inviteFamilyId = null;
      let inviteDoc = null;
      let isLegacy = false;

      if (sanitizedCode) {
        // ... (invite resolving logic)
        const q1 = query(collection(db, 'invites'), where('code', '==', sanitizedCode), where('used', '==', false));
        const snap1 = await getDocs(q1);
        if (!snap1.empty) {
          inviteDoc = snap1.docs[0];
          isLegacy = true;
          inviteFamilyId = inviteDoc.data().familyId;
        } else {
          const docRef = doc(db, 'invite_codes', sanitizedCode);
          const docSnap = await getDoc(docRef);
          if (docSnap.exists() && docSnap.data().status === 'active') {
            inviteDoc = docSnap;
            inviteFamilyId = docSnap.data().familyId;
          } else {
            const q2 = query(collection(db, 'invite_codes'), where('code', '==', sanitizedCode), where('status', '==', 'active'));
            const snap2 = await getDocs(q2);
            if (!snap2.empty) {
              inviteDoc = snap2.docs[0];
              inviteFamilyId = inviteDoc.data().familyId;
            }
          }
        }
      }

      const finalFamilyId = emailMatchFamilyId || inviteFamilyId;

      // 4. Complete Onboarding with Retry
      const completeOnboarding = async (user: any, retry = 0): Promise<void> => {
        try {
          const batch = writeBatch(db);
          batch.set(doc(db, 'users', user.uid), {
            uid: user.uid,
            email: lowerEmail,
            role: 'member',
            familyId: finalFamilyId,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp()
          });

          if (inviteDoc) {
            const inviteData = inviteDoc.data();
            if (isLegacy) {
              batch.update(doc(db, 'invites', inviteDoc.id), {
                used: true,
                usedBy: user.uid,
                updatedAt: serverTimestamp()
              });
            } else {
              batch.update(doc(db, 'invite_codes', inviteDoc.id), {
                usedCount: (inviteData.usedCount || 0) + 1,
                updatedAt: serverTimestamp(),
                status: (inviteData.usedCount || 0) + 1 >= (inviteData.maxUses || 10) ? 'revoked' : 'active'
              });
            }
          }
          
          if (finalFamilyId) {
            const famRef = doc(db, 'families', finalFamilyId);
            const currentFamSnap = await getDoc(famRef);
            if (currentFamSnap.exists()) {
              const famData = currentFamSnap.data();
              let updatedMembers = [...(famData.members || [])];
              if (emailMatchFamilyId === finalFamilyId && existingMemberIndex !== -1) {
                updatedMembers[existingMemberIndex] = { ...updatedMembers[existingMemberIndex], uid: user.uid };
              } else {
                updatedMembers.push({ name: lowerEmail.split('@')[0], email: lowerEmail, role: 'Member', uid: user.uid });
              }
              batch.update(famRef, {
                memberUids: Array.from(new Set([...(famData.memberUids || []), user.uid])),
                members: updatedMembers,
                updatedAt: serverTimestamp()
              });
            }
          }
          await batch.commit();
        } catch (error: any) {
          if (retry === 0 && (error.code === 'permission-denied' || error.message?.includes('insufficient permissions'))) {
            await new Promise(resolve => setTimeout(resolve, 500));
            return completeOnboarding(user, 1);
          }
          throw error;
        }
      };

      await completeOnboarding(newUser);
      toast.success("Account created successfully!");
    } catch (error: any) {
      console.error(error);
      handleFirestoreError(error, OperationType.WRITE, 'users/register');
      toast.error(error.message || "Registration failed");
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) {
      toast.error("Please enter your email address first.");
      return;
    }
    setLoading(true);
    try {
      await sendPasswordResetEmail(auth, email);
      toast.success("Password reset email sent! Please check your inbox.");
      setIsResetMode(false);
    } catch (error: any) {
      toast.error(error.message || "Failed to send reset email");
    } finally {
      setLoading(false);
    }
  };

  const handleRequestAccess = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!requestForm.name || !requestForm.email) {
      toast.error("Name and Email are required.");
      return;
    }
    setLoading(true);
    try {
      await addDoc(collection(db, 'requests'), {
        ...requestForm,
        status: 'pending',
        createdAt: serverTimestamp()
      });
      toast.success("Access request sent successfully! We'll be in touch.");
      setView('home');
      setRequestForm({ name: '', email: '', message: '' });
    } catch (error: any) {
      console.error(error);
      handleFirestoreError(error, OperationType.WRITE, 'requests/create');
      toast.error("Failed to send request: " + error.message);
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    const sanitizedCode = inviteCode.trim().toUpperCase();
    if (!sanitizedCode) return;
    setLoading(true);
    console.log(`Manually verifying code: ${sanitizedCode}`);

    try {
      // 1. Check legacy invites
      let q = query(collection(db, 'invites'), where('code', '==', sanitizedCode), where('used', '==', false));
      let querySnapshot = await getDocs(q);
      
      if (!querySnapshot.empty) {
        console.log('Manual verify: Found legacy code');
        toast.success("Valid code! Please create your account to finish joining the directory.");
        setView('register');
        return;
      }

      // 2. Check Doc ID
      const docRef = doc(db, 'invite_codes', sanitizedCode);
      const docSnap = await getDoc(docRef);
      if (docSnap.exists()) {
        const data = docSnap.data();
        if (data.status === 'active' && (data.usedCount || 0) < (data.maxUses || 10)) {
          console.log('Manual verify: Found Doc ID');
          toast.success("Valid code! Please create your account.");
          setView('register');
          return;
        }
        console.log(`Manual verify rejection: status ${data.status}, used ${data.usedCount}/${data.maxUses}`);
      }

      // 3. Check field
      q = query(collection(db, 'invite_codes'), where('code', '==', sanitizedCode), where('status', '==', 'active'));
      querySnapshot = await getDocs(q);

      if (querySnapshot.empty) {
        console.log('Manual verify: Not found');
        toast.error("Invalid or expired invite code.");
      } else {
        console.log('Manual verify: Found field');
        toast.success("Valid code! Please create your account to finish joining the directory.");
        setView('register');
      }
    } catch (error: any) {
      console.error(error);
      handleFirestoreError(error, OperationType.LIST, 'invites/manual_verify');
      toast.error("Error: " + error.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col md:flex-row bg-bg-natural">
      {/* Branding Side */}
      <div className="md:flex-1 bg-sage p-12 flex flex-col justify-between text-white relative overflow-hidden">
        <div className="absolute inset-0 opacity-10 pointer-events-none">
           <svg className="w-full h-full" viewBox="0 0 100 100" preserveAspectRatio="none">
              <path d="M0 100 C 20 0 50 0 100 100 Z" fill="currentColor" />
           </svg>
        </div>
        
        <motion.div 
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          className="relative z-10"
        >
          <div className="w-40 h-auto mb-10 p-4 bg-white/10 backdrop-blur-sm rounded-3xl group transition-all hover:bg-white/15">
            <img 
              src="/logo.png" 
              alt="Redeemer Directory Logo" 
              className="w-full h-auto brightness-0 invert opacity-90 transition-transform group-hover:scale-105"
            />
          </div>
          <h1 className="text-5xl md:text-7xl font-serif leading-tight mb-6">Redeemer</h1>
          <p className="text-sm font-sans uppercase tracking-[0.3em] opacity-80">Directory</p>
        </motion.div>
      </div>

      {/* Auth Side */}
      <div className="flex-1 flex items-center justify-center p-8 md:p-20 bg-cream relative">
        <AnimatePresence mode="wait">
          {view === 'home' && (
            <motion.div 
              key="home"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="w-full max-w-sm space-y-12"
            >
              <div className="space-y-4">
                <h2 className="text-4xl text-stone font-serif">Welcome home.</h2>
                <p className="text-sm text-stone-light">
                  This directory is a private space for our church family. How would you like to proceed?
                </p>
              </div>

              <div className="flex flex-col gap-4">
                <button 
                  onClick={() => setView('login')}
                  className="w-full py-5 bg-terracotta text-white rounded-2xl font-bold uppercase tracking-widest text-xs hover:brightness-110 shadow-lg shadow-terracotta/10 transition-all flex items-center justify-center gap-3 group"
                >
                  <LogIn size={18} className="group-hover:translate-x-1 transition-transform" /> Sign In
                </button>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <button 
                    onClick={() => setView('invite')}
                    className="py-5 bg-white border border-stone-border text-stone rounded-2xl font-bold uppercase tracking-widest text-[10px] hover:bg-stone/5 transition-all flex flex-col items-center justify-center gap-2"
                  >
                    <Key size={18} className="text-sage" /> Invite Code
                  </button>
                  <button 
                    onClick={() => setView('request')}
                    className="py-5 bg-white border border-stone-border text-stone rounded-2xl font-bold uppercase tracking-widest text-[10px] hover:bg-stone/5 transition-all flex flex-col items-center justify-center gap-2"
                  >
                    <UserPlus size={18} className="text-sage" /> Request Access
                  </button>
                </div>
              </div>
            </motion.div>
          )}

          {view === 'login' && (
            <motion.div 
              key="login"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 20 }}
              className="w-full max-w-sm space-y-8"
            >
              <div className="flex items-center justify-between mb-8">
                <button 
                  onClick={() => setView('home')} 
                  className="text-stone-light hover:text-stone transition-colors flex items-center gap-2 text-xs font-bold uppercase tracking-widest"
                >
                  <ArrowLeft size={16} /> Back
                </button>
                <h2 className="text-2xl font-serif text-stone">{isResetMode ? "Reset Password" : "Member Sign In"}</h2>
              </div>

              {isResetMode ? (
                <form onSubmit={handleResetPassword} className="space-y-6">
                  <div className="space-y-2">
                    <label className="block text-[10px] uppercase tracking-widest font-bold text-stone-light">Email Address</label>
                    <input 
                      type="email" 
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="w-full p-4 bg-white border border-stone-border rounded-2xl focus:ring-4 focus:ring-sage/5 outline-none transition-all"
                      placeholder="name@example.com"
                      required
                    />
                  </div>
                  <div className="space-y-4 pt-4">
                    <button 
                      type="submit"
                      disabled={loading}
                      className="w-full py-4 bg-terracotta text-white rounded-full font-medium hover:brightness-110 transition-all disabled:opacity-50"
                    >
                      {loading ? "Sending..." : "Send Reset Link"}
                    </button>
                    <button 
                      type="button"
                      onClick={() => setIsResetMode(false)}
                      className="w-full text-center text-xs text-stone-light hover:text-stone font-medium uppercase tracking-widest"
                    >
                      Back to Sign In
                    </button>
                  </div>
                </form>
              ) : (
                <form onSubmit={handleLogin} className="space-y-6">
                  <div className="space-y-2">
                    <label className="block text-[10px] uppercase tracking-widest font-bold text-stone-light">Email Address</label>
                    <input 
                      type="email" 
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="w-full p-4 bg-white border border-stone-border rounded-2xl focus:ring-4 focus:ring-sage/5 outline-none transition-all"
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <div className="flex justify-between items-end">
                      <label className="block text-[10px] uppercase tracking-widest font-bold text-stone-light">Password</label>
                      <button 
                        type="button" 
                        onClick={() => setIsResetMode(true)}
                        className="text-[10px] uppercase tracking-widest font-bold text-sage hover:text-stone transition-colors"
                      >
                        Forgot?
                      </button>
                    </div>
                    <input 
                      type="password" 
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="w-full p-4 bg-white border border-stone-border rounded-2xl focus:ring-4 focus:ring-sage/5 outline-none transition-all"
                      required
                    />
                  </div>
                  <button 
                    type="submit"
                    disabled={loading}
                    className="w-full py-4 bg-terracotta text-white rounded-full font-medium hover:brightness-110 transition-all disabled:opacity-50"
                    id="submit-login-btn"
                  >
                    {loading ? "Authenticating..." : "Sign In"}
                  </button>
                </form>
              )}
            </motion.div>
          )}

          {view === 'register' && (
            <motion.div 
              key="register"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 20 }}
              className="w-full max-w-sm space-y-8"
            >
              <div className="flex items-center justify-between mb-8">
                <button onClick={() => setView('home')} className="text-stone-light hover:text-stone transition-colors flex items-center gap-2 text-xs font-bold uppercase tracking-widest">
                  <ArrowLeft size={16} /> Cancel
                </button>
                <h2 className="text-2xl font-serif text-stone">Create Your Account</h2>
              </div>

              <form onSubmit={handleRegister} className="space-y-6">
                <div className="space-y-2">
                  <label className="block text-[10px] uppercase tracking-widest font-bold text-stone-light">Email Address</label>
                  <input 
                    type="email" 
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full p-4 bg-white border border-stone-border rounded-2xl focus:ring-4 focus:ring-sage/5 outline-none transition-all"
                    placeholder="name@example.com"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <label className="block text-[10px] uppercase tracking-widest font-bold text-stone-light">Create Password</label>
                  <input 
                    type="password" 
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full p-4 bg-white border border-stone-border rounded-2xl focus:ring-4 focus:ring-sage/5 outline-none transition-all"
                    placeholder="Minimum 6 characters"
                    required
                  />
                </div>
                <button 
                  type="submit"
                  disabled={loading}
                  className="w-full py-5 bg-sage text-white rounded-2xl font-bold uppercase tracking-widest text-xs hover:brightness-110 transition-all flex items-center justify-center gap-3"
                >
                  {loading ? "Creating..." : "Finish Registration"}
                </button>
              </form>
            </motion.div>
          )}

          {view === 'error' && (
            <motion.div 
              key="error"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="w-full max-w-sm space-y-8 text-center"
            >
              <div className="w-16 h-16 bg-terracotta/10 text-terracotta rounded-full flex items-center justify-center mx-auto">
                <AlertTriangle size={32} />
              </div>
              <div className="space-y-4">
                <h2 className="text-2xl font-serif text-stone">Oops! Something went wrong</h2>
                <p className="text-sm text-stone-light">
                  {errorMsg || "The invitation code you provided is invalid or expired."}
                </p>
              </div>
              <button 
                onClick={() => navigate('/')}
                className="w-full py-5 bg-stone text-white rounded-2xl font-bold uppercase tracking-widest text-xs hover:bg-stone/90 transition-all cursor-pointer"
              >
                Return to Login
              </button>
            </motion.div>
          )}

          {view === 'invite' && (
            <motion.div 
              key="invite"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 20 }}
              className="w-full max-w-sm space-y-8"
            >
              <div className="flex items-center justify-between mb-8">
                <button onClick={() => setView('home')} className="text-stone-light hover:text-stone transition-colors flex items-center gap-2 text-xs font-bold uppercase tracking-widest">
                  <ArrowLeft size={16} /> Back
                </button>
                <h2 className="text-2xl font-serif text-stone">Enter Invite Code</h2>
              </div>

              <form onSubmit={handleVerifyInvite} className="space-y-6">
                <div className="space-y-2">
                  <label className="block text-[10px] uppercase tracking-widest font-bold text-stone-light">Invite Code</label>
                  <input 
                    type="text" 
                    value={inviteCode}
                    onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
                    className="w-full p-6 bg-white border-2 border-stone-border rounded-3xl focus:border-sage focus:ring-4 focus:ring-sage/5 outline-none transition-all text-center text-3xl font-mono tracking-widest"
                    placeholder="CODE HERE"
                    required
                  />
                </div>
                <button 
                  type="submit"
                  disabled={loading}
                  className="w-full py-5 bg-sage text-white rounded-2xl font-bold uppercase tracking-widest text-xs hover:brightness-110 transition-all flex items-center justify-center gap-3"
                >
                  {loading ? "Checking..." : "Verify Code"}
                </button>
                <div className="p-6 bg-stone/5 rounded-3xl text-center">
                  <p className="text-xs text-stone-light">
                    Codes are unique to each family. Multiple members of your family can enter the same code. If you don't have one, email <a href="mailto:ruby@redeemeratl.org" target="_blank" rel="noopener noreferrer" className="text-sage font-semibold hover:underline">ruby@redeemeratl.org</a> to request one.
                  </p>
                </div>
              </form>
            </motion.div>
          )}

          {view === 'request' && (
            <motion.div 
              key="request"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 20 }}
              className="w-full max-w-sm space-y-8"
            >
              <div className="flex items-center justify-between mb-8">
                <button onClick={() => setView('home')} className="text-stone-light hover:text-stone transition-colors flex items-center gap-2 text-xs font-bold uppercase tracking-widest">
                  <ArrowLeft size={16} /> Back
                </button>
                <h2 className="text-2xl font-serif text-stone">Request Access</h2>
              </div>

              <form onSubmit={handleRequestAccess} className="space-y-4">
                <div className="space-y-2">
                  <label className="block text-[10px] uppercase tracking-widest font-bold text-stone-light">Your Name</label>
                  <input 
                    type="text" 
                    value={requestForm.name}
                    onChange={(e) => setRequestForm({ ...requestForm, name: e.target.value })}
                    className="w-full p-4 bg-white border border-stone-border rounded-xl focus:ring-4 focus:ring-sage/5 outline-none transition-all"
                    placeholder="Full Name"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <label className="block text-[10px] uppercase tracking-widest font-bold text-stone-light">Email Address</label>
                  <input 
                    type="email" 
                    value={requestForm.email}
                    onChange={(e) => setRequestForm({ ...requestForm, email: e.target.value })}
                    className="w-full p-4 bg-white border border-stone-border rounded-xl focus:ring-4 focus:ring-sage/5 outline-none transition-all"
                    placeholder="name@example.com"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <label className="block text-[10px] uppercase tracking-widest font-bold text-stone-light">Message (Optional)</label>
                  <textarea 
                    value={requestForm.message}
                    onChange={(e) => setRequestForm({ ...requestForm, message: e.target.value })}
                    className="w-full p-4 bg-white border border-stone-border rounded-xl focus:ring-4 focus:ring-sage/5 outline-none transition-all h-24 resize-none"
                    placeholder="A brief message to the administrator..."
                  />
                </div>
                <button 
                  type="submit"
                  disabled={loading}
                  className="w-full py-5 bg-terracotta text-white rounded-2xl font-bold uppercase tracking-widest text-xs hover:brightness-110 transition-all flex items-center justify-center gap-3"
                >
                  {loading ? "Sending..." : "Submit Request"} <Send size={16} />
                </button>
              </form>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
