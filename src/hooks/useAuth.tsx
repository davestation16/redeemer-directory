import React, { useState, useEffect, createContext, useContext } from 'react';
import { User, onAuthStateChanged } from 'firebase/auth';
import { doc, getDoc, setDoc, serverTimestamp, collection, query, where, getDocs, writeBatch, onSnapshot } from 'firebase/firestore';
import { auth, db } from '../lib/firebase';
import { UserProfile, UserRole } from '../types';

interface AuthContextType {
  user: User | null;
  profile: UserProfile | null;
  loading: boolean;
  isAdmin: boolean;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  profile: null,
  loading: true,
  isAdmin: false,
});

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [authState, setAuthState] = useState<{
    user: User | null;
    profile: UserProfile | null;
    loading: boolean;
  }>({
    user: null,
    profile: null,
    loading: true,
  });

  const bootstrapAdmin = async (firebaseUser: User) => {
    const isAdminEmail = firebaseUser.email === 'davedotgordon@gmail.com';
    if (!isAdminEmail) return null;

    try {
      const batch = writeBatch(db);
      
      // 1. Check/Create Family
      const familiesRef = collection(db, 'families');
      const gordonQuery = query(familiesRef, where('familyName', '==', 'Gordon'));
      const gordonDocs = await getDocs(gordonQuery);
      
      let familyId: string;
      if (gordonDocs.empty) {
        const familyRef = doc(familiesRef);
        familyId = familyRef.id;
        batch.set(familyRef, {
          familyName: 'Gordon',
          members: [{
            name: 'Dave Gordon',
            email: firebaseUser.email || '',
            role: 'Primary Adult'
          }],
          memberUids: [firebaseUser.uid],
          photoStatus: 'approved',
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } else {
        familyId = gordonDocs.docs[0].id;
        const familyData = gordonDocs.docs[0].data();
        if (!familyData.memberUids?.includes(firebaseUser.uid)) {
          batch.update(doc(db, 'families', familyId), {
            memberUids: Array.from(new Set([...(familyData.memberUids || []), firebaseUser.uid])),
            updatedAt: serverTimestamp()
          });
        }
      }

      // 2. Create/Update Admin User Profile
      const userDocRef = doc(db, 'users', firebaseUser.uid);
      const newProfile: UserProfile = {
        uid: firebaseUser.uid,
        email: firebaseUser.email || '',
        role: 'admin',
        familyId: familyId,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      
      batch.set(userDocRef, newProfile);
      await batch.commit();
      return newProfile;
    } catch (error) {
      console.error("Bootstrap error:", error);
      return null;
    }
  };

  const lazyOnboardUser = async (firebaseUser: User, retryCount = 0): Promise<UserProfile | null> => {
    try {
      console.log(`Lazy Onboarding attempt ${retryCount + 1} for ${firebaseUser.email}`);
      const lowerEmail = firebaseUser.email?.toLowerCase().trim();
      if (!lowerEmail) return null;

      // 1. Search for existing family membership by email
      const familiesRef = collection(db, 'families');
      const familiesSnap = await getDocs(familiesRef);
      
      let matchedFamilyId = null;
      let memberIndex = -1;

      for (const fDoc of familiesSnap.docs) {
        const fData = fDoc.data();
        const members = fData.members || [];
        const mIndex = members.findIndex((m: any) => m.email?.toLowerCase().trim() === lowerEmail);
        if (mIndex !== -1) {
          matchedFamilyId = fDoc.id;
          memberIndex = mIndex;
          break;
        }
      }

      const batch = writeBatch(db);
      const userDocRef = doc(db, 'users', firebaseUser.uid);
      
      const newProfile: UserProfile = {
        uid: firebaseUser.uid,
        email: lowerEmail,
        role: 'member',
        familyId: matchedFamilyId,
        hasSeenTutorial: false,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      } as UserProfile;

      batch.set(userDocRef, newProfile);

      if (matchedFamilyId) {
        const famRef = doc(db, 'families', matchedFamilyId);
        const famSnap = await getDoc(famRef);
        if (famSnap.exists()) {
          const famData = famSnap.data();
          let updatedMembers = [...(famData.members || [])];
          
          // Link UID in the members array
          if (memberIndex !== -1) {
            updatedMembers[memberIndex] = {
              ...updatedMembers[memberIndex],
              uid: firebaseUser.uid
            };
          }

          batch.update(famRef, {
            memberUids: Array.from(new Set([...(famData.memberUids || []), firebaseUser.uid])),
            members: updatedMembers,
            updatedAt: serverTimestamp()
          });
        }
      }

      await batch.commit();
      console.log(`Lazy Onboarding success for ${firebaseUser.email}`);
      return newProfile;

    } catch (error: any) {
      console.error("Lazy onboarding error:", error);
      
      // PERMISSION RETRY: If first write fails, wait 500ms and retry once
      // This is common when Auth token isn't fully propagated yet
      if (retryCount === 0 && (error.code === 'permission-denied' || error.message?.includes('insufficient permissions'))) {
        await new Promise(resolve => setTimeout(resolve, 500));
        return lazyOnboardUser(firebaseUser, 1);
      }
      
      return null;
    }
  };

  useEffect(() => {
    let profileUnsubscribe: (() => void) | null = null;

    const authUnsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (profileUnsubscribe) {
        profileUnsubscribe();
        profileUnsubscribe = null;
      }

      if (firebaseUser) {
        const userDocRef = doc(db, 'users', firebaseUser.uid);
        
        profileUnsubscribe = onSnapshot(userDocRef, async (snap) => {
          let currentProfile: UserProfile | null = null;

          if (snap.exists()) {
            currentProfile = snap.data() as UserProfile;
            
            if (firebaseUser.email === 'davedotgordon@gmail.com' && (currentProfile.role !== 'admin' || !currentProfile.familyId)) {
              currentProfile = await bootstrapAdmin(firebaseUser);
            }
          } else {
            // New User Bootstrap / Lazy Onboarding
            currentProfile = await bootstrapAdmin(firebaseUser);
            if (!currentProfile) {
              currentProfile = await lazyOnboardUser(firebaseUser);
            }
          }

          setAuthState({
            user: firebaseUser,
            profile: currentProfile,
            loading: false
          });
        });
      } else {
        setAuthState({
          user: null,
          profile: null,
          loading: false
        });
      }
    });

    return () => {
      authUnsubscribe();
      if (profileUnsubscribe) profileUnsubscribe();
    };
  }, []);

  return (
    <AuthContext.Provider value={{ 
      ...authState,
      isAdmin: authState.profile?.role === 'admin' || authState.user?.email === 'davedotgordon@gmail.com'
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
