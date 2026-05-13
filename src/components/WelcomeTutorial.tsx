import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { CheckCircle2, Sparkles, Home, Users, Camera } from 'lucide-react';
import { db } from '../lib/firebase';
import { doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { useAuth } from '../hooks/useAuth';
import { toast } from 'sonner';

interface WelcomeTutorialProps {
  onComplete: () => void;
}

export const WelcomeTutorial: React.FC<WelcomeTutorialProps> = ({ onComplete }) => {
  const { profile } = useAuth();

  const handleComplete = async () => {
    if (!profile) return;
    
    try {
      await updateDoc(doc(db, 'users', profile.uid), {
        hasSeenTutorial: true,
        updatedAt: serverTimestamp()
      });
      onComplete();
    } catch (error) {
      console.error("Error updating tutorial status:", error);
      toast.error("Failed to save progress, but you can continue.");
      onComplete();
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-stone/60 backdrop-blur-sm">
      <motion.div 
        initial={{ opacity: 0, scale: 0.9, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.9, y: 20 }}
        className="bg-white rounded-[40px] shadow-2xl max-w-lg w-full overflow-hidden"
      >
          <div className="bg-sage p-10 text-white text-center relative">
            <div className="absolute top-4 right-4 opacity-20">
              <Sparkles size={48} />
            </div>
            <div className="w-20 h-20 bg-white/20 rounded-3xl flex items-center justify-center mx-auto mb-6 backdrop-blur-md">
              <CheckCircle2 size={40} className="text-white" />
            </div>
            <h2 className="font-serif text-3xl mb-2">Welcome to the Redeemer Directory!</h2>
            <p className="text-white/80 text-sm">We're so glad you're here.</p>
          </div>

          <div className="p-10 space-y-8">
            <p className="text-stone-light leading-relaxed text-center">
              To get started, please visit the <strong className="text-stone">"Edit My Details"</strong> page to add your members, update your contact info, and upload a family photo.
            </p>

            <div className="grid grid-cols-3 gap-4 py-4">
              <div className="flex flex-col items-center gap-2 text-center">
                <div className="p-3 bg-sage/10 text-sage rounded-2xl">
                  <Users size={20} />
                </div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-stone-light">Add Members</span>
              </div>
              <div className="flex flex-col items-center gap-2 text-center">
                <div className="p-3 bg-sage/10 text-sage rounded-2xl">
                  <Home size={20} />
                </div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-stone-light">Contact Info</span>
              </div>
              <div className="flex flex-col items-center gap-2 text-center">
                <div className="p-3 bg-sage/10 text-sage rounded-2xl">
                  <Camera size={20} />
                </div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-stone-light">Family Photo</span>
              </div>
            </div>

            <button
              id="tutorial-complete-btn"
              onClick={handleComplete}
              className="w-full py-5 bg-stone text-white rounded-2xl font-bold uppercase tracking-[0.2em] text-xs hover:bg-sage transition-all shadow-xl shadow-stone/10 transform active:scale-95"
            >
              Got it! Take me there
            </button>
          </div>
    </motion.div>
  </div>
);
};
