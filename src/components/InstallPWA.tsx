import React, { useEffect, useState } from 'react';
import { Download } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

export default function InstallPWA() {
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const handler = (e: any) => {
      // Prevent the mini-infobar from appearing on mobile
      e.preventDefault();
      // Stash the event so it can be triggered later.
      setDeferredPrompt(e);
      // Update UI notify the user they can install the PWA
      setIsVisible(true);
      console.log('beforeinstallprompt event was fired');
    };

    window.addEventListener('beforeinstallprompt', handler);

    // Check if already installed
    if (window.matchMedia('(display-mode: standalone)').matches) {
      setIsVisible(false);
    }

    return () => {
      window.removeEventListener('beforeinstallprompt', handler);
    };
  }, []);

  const handleInstallClick = async () => {
    if (!deferredPrompt) return;

    // Show the install prompt
    deferredPrompt.prompt();

    // Wait for the user to respond to the prompt
    const { outcome } = await deferredPrompt.userChoice;
    console.log(`User responded to the install prompt: ${outcome}`);

    // We've used the prompt, and can't use it again, throw it away
    setDeferredPrompt(null);
    setIsVisible(false);
  };

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          initial={{ opacity: 0, y: 50 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 50 }}
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[100] w-[90%] max-w-sm"
        >
          <div className="bg-white rounded-2xl shadow-2xl p-4 border border-stone-border/30 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-sage/10 rounded-xl flex items-center justify-center text-sage">
                <Download size={20} />
              </div>
              <div className="text-left">
                <h3 className="text-sm font-semibold text-stone">Install App</h3>
                <p className="text-xs text-stone-light">Add to your home screen for easy access</p>
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setIsVisible(false)}
                className="px-3 py-2 text-xs font-medium text-stone-light hover:text-stone transition-colors"
              >
                Not now
              </button>
              <button
                onClick={handleInstallClick}
                className="px-4 py-2 bg-sage text-white text-xs font-bold rounded-lg hover:bg-sage/90 transition-colors shadow-lg shadow-sage/20"
              >
                Install
              </button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
