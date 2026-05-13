import React, { useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { db, auth } from '../lib/firebase';
import { collection, query, where, getDocs, getDoc, doc, updateDoc, serverTimestamp, writeBatch } from 'firebase/firestore';
import { toast } from 'sonner';
import { Mail, Key, LogOut } from 'lucide-react';
import { signOut } from 'firebase/auth';
import { motion } from 'motion/react';

export default function InviteRequired() {
  const { profile } = useAuth();
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile) return;
    setLoading(true);

    const sanitizedCode = code.trim().toUpperCase();
    console.log(`Input received: ${sanitizedCode}`);

    try {
      // 1. Check legacy invites
      let q = query(collection(db, 'invites'), where('code', '==', sanitizedCode), where('used', '==', false));
      let querySnapshot = await getDocs(q);
      
      let isLegacy = !querySnapshot.empty;
      let inviteDoc = !querySnapshot.empty ? querySnapshot.docs[0] : null;

      if (!inviteDoc) {
        // 2. Check new family-linked invite_codes by Doc ID
        const docRef = doc(db, 'invite_codes', sanitizedCode);
        const docSnap = await getDoc(docRef);
        
        if (docSnap.exists()) {
          console.log('Query result: found by Document ID');
          inviteDoc = docSnap;
          isLegacy = false;
        } else {
          // 3. Check new family-linked invite_codes by 'code' field
          q = query(collection(db, 'invite_codes'), where('code', '==', sanitizedCode));
          querySnapshot = await getDocs(q);
          if (!querySnapshot.empty) {
            console.log('Query result: found by code field');
            inviteDoc = querySnapshot.docs[0];
            isLegacy = false;
          }
        }
      }

      if (!inviteDoc) {
        console.log('Query result: not found');
        toast.error("Invalid invite code.");
        setLoading(false);
        return;
      }

      const inviteData = inviteDoc.data();
      
      // Strict Status & Expiry Checks
      if (!isLegacy) {
        const status = inviteData?.status?.toLowerCase();
        if (status !== 'active') {
          console.log(`Reason for rejection: status is ${status}`);
          toast.error("This invite code is no longer active.");
          setLoading(false);
          return;
        }

        const usedCount = inviteData?.usedCount || 0;
        const maxUses = inviteData?.maxUses || 10;
        if (usedCount >= maxUses) {
          console.log(`Reason for rejection: max uses (${maxUses}) reached`);
          toast.error("This invite code has reached its maximum use limit.");
          setLoading(false);
          return;
        }
      } else {
        if (inviteData?.used) {
          console.log('Reason for rejection: legacy code already used');
          toast.error("This invite code has already been used.");
          setLoading(false);
          return;
        }
      }

      // If we got here, it's valid
      const batch = writeBatch(db);

      // Update user profile
      batch.update(doc(db, 'users', profile.uid), {
        role: 'member',
        familyId: inviteData?.familyId || null,
        updatedAt: serverTimestamp()
      });

      if (isLegacy) {
        // Mark legacy invite as used
        batch.update(doc(db, 'invites', inviteDoc.id), {
          used: true,
          usedBy: profile.uid,
          updatedAt: serverTimestamp()
        });
      } else {
        // Update family-specific code
        batch.update(doc(db, 'invite_codes', inviteDoc.id), {
          usedCount: (inviteData?.usedCount || 0) + 1,
          updatedAt: serverTimestamp(),
          status: (inviteData?.usedCount || 0) + 1 >= (inviteData?.maxUses || 10) ? 'revoked' : 'active'
        });
        
        if (inviteData?.familyId) {
          // Link user to family document
          const familyRef = doc(db, 'families', inviteData.familyId);
          batch.update(familyRef, {
            memberUids: Array.from(new Set([...(inviteData?.memberUids || []), profile.uid])),
            photoStatus: 'approved',
            updatedAt: serverTimestamp()
          });
        }
      }

      await batch.commit();
      console.log('Success: Invite processed and user linked to family.');
      toast.success("Welcome to the community!");
      window.location.reload(); 
    } catch (error: any) {
      console.error("Error verifying code:", error);
      toast.error("Error verifying code: " + error.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-cream">
      <motion.div 
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="w-full max-w-md bg-white p-12 rounded-3xl shadow-card border border-stone-border text-center"
      >
        <div className="w-16 h-16 bg-sage/10 text-sage rounded-full flex items-center justify-center mx-auto mb-8">
          <Key size={32} />
        </div>
        <h1 className="text-3xl font-serif text-stone mb-4">Invite Required</h1>
        <p className="text-sm text-stone-light mb-8">
          Welcome, {profile?.email}. You've authenticated successfully, but this directory is limited to church members. 
          Please enter your unique invite code below.
        </p>

        <form onSubmit={handleVerify} className="space-y-4 text-left">
          <div className="space-y-2">
            <label className="block text-[10px] uppercase tracking-widest font-bold text-stone-light">Invite Code</label>
            <input 
              type="text" 
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              className="w-full p-4 bg-gray-50 border border-stone-border rounded-xl focus:ring-4 focus:ring-sage/5 outline-none transition-all uppercase font-mono tracking-widest"
              placeholder="CODE HERE"
              required
            />
          </div>
          <button 
            type="submit"
            disabled={loading}
            className="w-full py-4 bg-terracotta text-white rounded-full font-medium hover:brightness-110 shadow-lg shadow-terracotta/10 transition-all disabled:opacity-50"
          >
            {loading ? "Verifying..." : "Join Directory"}
          </button>
        </form>

        <div className="mt-8 pt-8 border-t border-stone-border flex flex-col gap-4">
          <a 
            href="mailto:ruby@redeemeratl.org?subject=Missing Invite Code"
            className="text-xs text-sage font-semibold flex items-center justify-center gap-2 hover:text-stone transition-colors"
          >
            <Mail size={14} /> I don't have a code
          </a>
          <button 
            onClick={() => signOut(auth)}
            className="text-xs text-stone-light hover:text-red-500 flex items-center justify-center gap-2 transition-colors"
          >
            <LogOut size={14} /> Sign out
          </button>
        </div>
      </motion.div>
    </div>
  );
}
