import React from 'react';
import { Calendar as CalendarIcon, Smartphone, Mail, Copy, Check, Apple, ExternalLink } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'sonner';

interface SyncModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function CalendarSyncModal({ isOpen, onClose }: SyncModalProps) {
  const [activeTab, setActiveTab] = React.useState<'apple' | 'google'>('apple');
  const [copied, setCopied] = React.useState(false);

  const feedUrl = `${window.location.origin}/api/calendar/feed.ics?token=Redeemer2026`;
  const webcalUrl = feedUrl.replace('https://', 'webcal://').replace('http://', 'webcal://');

  const copyToClipboard = () => {
    navigator.clipboard.writeText(feedUrl);
    setCopied(true);
    toast.success("Link copied to clipboard!");
    setTimeout(() => setCopied(false), 2000);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 sm:p-12">
      <motion.div 
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="absolute inset-0 bg-stone/40 backdrop-blur-sm"
      />
      
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
        className="bg-white w-full max-w-xl rounded-[2.5rem] shadow-2xl relative overflow-hidden flex flex-col max-h-[90vh]"
      >
        <div className="p-8 pb-4">
          <div className="flex items-center justify-between mb-8">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-sage/10 rounded-2xl flex items-center justify-center text-sage">
                <Smartphone size={24} />
              </div>
              <div>
                <h2 className="text-2xl font-serif text-stone leading-tight">Sync to Your Phone</h2>
                <p className="text-[10px] font-bold uppercase tracking-widest text-stone-light/60 mt-1">Birthdays & Anniversaries</p>
              </div>
            </div>
            <button onClick={onClose} className="p-2 hover:bg-stone-bg rounded-full transition-colors">
              <Check size={20} className="text-stone-light" />
            </button>
          </div>

          <div className="flex p-1 bg-stone-bg rounded-2xl mb-8">
            <button 
              onClick={() => setActiveTab('apple')}
              className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-bold transition-all ${activeTab === 'apple' ? 'bg-white text-stone shadow-sm' : 'text-stone-light hover:text-stone'}`}
            >
              <Apple size={16} /> iPhone / Mac
            </button>
            <button 
              onClick={() => setActiveTab('google')}
              className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-bold transition-all ${activeTab === 'google' ? 'bg-white text-stone shadow-sm' : 'text-stone-light hover:text-stone'}`}
            >
              <ExternalLink size={16} /> Google / Android
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-8 pb-8">
          <AnimatePresence mode="wait">
            {activeTab === 'apple' ? (
              <motion.div
                key="apple"
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 10 }}
                className="space-y-6"
              >
                <div className="p-6 bg-sage/5 rounded-3xl border border-sage/10">
                  <h4 className="font-bold text-stone mb-2">Automated Sync</h4>
                  <p className="text-stone-light text-sm leading-relaxed mb-6">
                    Tap the button below to automatically add all church celebrations to your iPhone or Mac calendar. It will stay synced!
                  </p>
                  <a 
                    href={webcalUrl}
                    className="flex items-center justify-center gap-3 w-full py-4 bg-sage text-white rounded-2xl font-bold hover:bg-sage/90 transition-all shadow-lg shadow-sage/10"
                  >
                    One-Click Subscribe
                  </a>
                </div>

                <div className="space-y-4">
                  <h4 className="text-[10px] font-black uppercase tracking-widest text-stone-light/40">Instructions</h4>
                  <ol className="space-y-3 text-sm text-stone-light">
                    <li className="flex gap-4">
                      <span className="w-6 h-6 rounded-full bg-stone-bg flex items-center justify-center text-[10px] font-bold shrink-0">1</span>
                      <span>Click the button above.</span>
                    </li>
                    <li className="flex gap-4">
                      <span className="w-6 h-6 rounded-full bg-stone-bg flex items-center justify-center text-[10px] font-bold shrink-0">2</span>
                      <span>When prompted, tap "Subscribe".</span>
                    </li>
                    <li className="flex gap-4">
                      <span className="w-6 h-6 rounded-full bg-stone-bg flex items-center justify-center text-[10px] font-bold shrink-0">3</span>
                      <span>The calendar will appear in your Apple Calendar app.</span>
                    </li>
                  </ol>
                </div>
              </motion.div>
            ) : (
              <motion.div
                key="google"
                initial={{ opacity: 0, x: 10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -10 }}
                className="space-y-6"
              >
                <div className="space-y-4">
                  <h4 className="font-bold text-stone">Setup via Google Calendar</h4>
                  <p className="text-stone-light text-sm leading-relaxed">
                    Google requires adding the feed URL manually. Follow these steps:
                  </p>
                  
                  <div className="relative group p-4 bg-stone-bg rounded-2xl border border-stone-border/50">
                    <p className="text-[10px] font-black uppercase tracking-widest text-stone-light/40 mb-2">Calendar Feed URL</p>
                    <div className="flex items-center gap-3">
                      <input 
                        readOnly 
                        value={feedUrl} 
                        className="bg-transparent text-xs font-mono text-stone w-full outline-none truncate"
                      />
                      <button 
                        onClick={copyToClipboard}
                        className="p-2 hover:bg-white rounded-lg transition-all text-sage"
                      >
                        {copied ? <Check size={16} /> : <Copy size={16} />}
                      </button>
                    </div>
                  </div>
                </div>

                <div className="space-y-4 pt-4">
                  <h4 className="text-[10px] font-black uppercase tracking-widest text-stone-light/40">Setup Steps</h4>
                  <ol className="space-y-3 text-sm text-stone-light">
                    <li className="flex gap-4">
                      <span className="w-6 h-6 rounded-full bg-stone-bg flex items-center justify-center text-[10px] font-bold shrink-0">1</span>
                      <span>Copy the link above.</span>
                    </li>
                    <li className="flex gap-4">
                      <span className="w-6 h-6 rounded-full bg-stone-bg flex items-center justify-center text-[10px] font-bold shrink-0">2</span>
                      <span>Open Google Calendar in a desktop browser.</span>
                    </li>
                    <li className="flex gap-4">
                      <span className="w-6 h-6 rounded-full bg-stone-bg flex items-center justify-center text-[10px] font-bold shrink-0">3</span>
                      <span>Click the <strong>+</strong> next to "Other calendars" and select "From URL".</span>
                    </li>
                    <li className="flex gap-4">
                      <span className="w-6 h-6 rounded-full bg-stone-bg flex items-center justify-center text-[10px] font-bold shrink-0">4</span>
                      <span>Paste the link and click "Add calendar".</span>
                    </li>
                  </ol>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>
    </div>
  );
}
