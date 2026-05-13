import React, { useState, useEffect } from 'react';
import { collection, getDocs, query } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { Family } from '../types';
import { 
  ChevronLeft, 
  ChevronRight, 
  Cake, 
  Heart, 
  Calendar as CalendarIcon,
  ChevronDown,
  ArrowRight,
  Smartphone
} from 'lucide-react';
import { 
  format, 
  addMonths, 
  subMonths, 
  startOfMonth, 
  endOfMonth, 
  startOfWeek, 
  endOfWeek, 
  eachDayOfInterval, 
  isSameMonth, 
  isSameDay, 
  addDays,
  isToday,
  parseISO
} from 'date-fns';
import { motion, AnimatePresence } from 'motion/react';
import { useNavigate } from 'react-router-dom';
import CalendarSyncModal from '../components/CalendarSyncModal';
import CalendarActions from '../components/CalendarActions';

interface CalendarEvent {
  date: Date;
  originalDate: string;
  type: 'birthday' | 'anniversary';
  label: string;
  familyId: string;
  entityName: string;
}

export default function Calendar() {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<'month' | 'list'>('month');
  const [isSyncModalOpen, setIsSyncModalOpen] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    const fetchEvents = async () => {
      setLoading(true);
      try {
        const familiesSnap = await getDocs(collection(db, 'families'));
        const families = familiesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Family));
        
        const allEvents: CalendarEvent[] = [];
        const currentYear = currentDate.getFullYear();

        families.forEach(family => {
          // Process birthdays
          family.members?.forEach(member => {
            if (member.birthday) {
              const parts = member.birthday.split('-');
              const m = parseInt(parts[1]);
              const d = parseInt(parts[2]);
              
              if (!isNaN(m) && !isNaN(d)) {
                allEvents.push({
                  date: new Date(currentYear, m - 1, d),
                  originalDate: member.birthday,
                  type: 'birthday',
                  label: `${member.name} ${family.familyName}'s Birthday`,
                  familyId: family.id,
                  entityName: member.name
                });
                // Add adjacent years
                allEvents.push({
                  date: new Date(currentYear - 1, m - 1, d),
                  originalDate: member.birthday,
                  type: 'birthday',
                  label: `${member.name} ${family.familyName}'s Birthday`,
                  familyId: family.id,
                  entityName: member.name
                });
                allEvents.push({
                  date: new Date(currentYear + 1, m - 1, d),
                  originalDate: member.birthday,
                  type: 'birthday',
                  label: `${member.name} ${family.familyName}'s Birthday`,
                  familyId: family.id,
                  entityName: member.name
                });
              }
            }
          });

          // Process anniversaries
          if (family.weddingAnniversary) {
            const parts = family.weddingAnniversary.split('-');
            const m = parseInt(parts[1]);
            const d = parseInt(parts[2]);
            if (!isNaN(m) && !isNaN(d)) {
                const displayLabel = family.members?.length === 1 
                  ? `${family.members[0].name} ${family.familyName}'s Anniversary`
                  : `The ${family.familyName} Family Anniversary`;
                const entityName = family.members?.length === 1
                  ? `${family.members[0].name} ${family.familyName}`
                  : `The ${family.familyName} Family`;
                
                allEvents.push({
                  date: new Date(currentYear, m - 1, d),
                  originalDate: family.weddingAnniversary,
                  type: 'anniversary',
                  label: displayLabel,
                  familyId: family.id,
                  entityName: entityName
                });
                allEvents.push({
                  date: new Date(currentYear - 1, m - 1, d),
                  originalDate: family.weddingAnniversary,
                  type: 'anniversary',
                  label: displayLabel,
                  familyId: family.id,
                  entityName: entityName
                });
                allEvents.push({
                  date: new Date(currentYear + 1, m - 1, d),
                  originalDate: family.weddingAnniversary,
                  type: 'anniversary',
                  label: displayLabel,
                  familyId: family.id,
                  entityName: entityName
                });
            }
          }
        });

        setEvents(allEvents);
      } catch (error) {
        console.error("Error fetching calendar events:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchEvents();
  }, [currentDate]);

  const nextMonth = () => setCurrentDate(addMonths(currentDate, 1));
  const prevMonth = () => setCurrentDate(subMonths(currentDate, 1));

  const monthStart = startOfMonth(currentDate);
  const monthEnd = endOfMonth(monthStart);
  const startDate = startOfWeek(monthStart);
  const endDate = endOfWeek(monthEnd);

  const calendarDays = eachDayOfInterval({
    start: startDate,
    end: endDate
  });

  const getEventsForDay = (day: Date) => {
    return events.filter(event => isSameDay(event.date, day));
  };

  // List View: Group current month events
  const monthEvents = events
    .filter(event => isSameMonth(event.date, currentDate))
    .sort((a, b) => a.date.getDate() - b.date.getDate());

  const groupedMonthEvents = monthEvents.reduce((acc, event) => {
    const dayKey = format(event.date, 'yyyy-MM-dd');
    if (!acc[dayKey]) acc[dayKey] = [];
    acc[dayKey].push(event);
    return acc;
  }, {} as Record<string, CalendarEvent[]>);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
        <div className="w-12 h-12 border-4 border-stone-border border-t-stone rounded-full animate-spin"></div>
        <p className="font-serif text-stone-light">Loading celebrations...</p>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto py-8 px-6">
      {/* Header */}
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-12">
        <div>
          <h1 className="font-serif text-4xl text-stone mb-2">Community Calendar</h1>
          <p className="text-stone-light font-medium flex items-center gap-2">
            <CalendarIcon size={16} />
            Birthdays & Anniversaries
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-4 bg-white border border-stone-border p-1.5 rounded-2xl shadow-sm">
          <button 
            onClick={() => setIsSyncModalOpen(true)}
            className="flex items-center gap-2 px-6 py-3 bg-stone text-white rounded-xl font-bold hover:bg-stone/90 transition-all shadow-lg shadow-stone/5 mr-2"
          >
            <Smartphone size={16} /> Sync to Phone
          </button>

          <div className="h-8 w-[1px] bg-stone-border/50 hidden md:block mx-2" />

          <button 
            onClick={prevMonth}
            className="p-3 hover:bg-stone-bg rounded-xl transition-all text-stone"
          >
            <ChevronLeft size={20} />
          </button>
          
          <div className="px-6 text-center min-w-[160px]">
            <h2 className="font-serif text-xl text-stone">{format(currentDate, 'MMMM')}</h2>
            <p className="text-[10px] font-bold uppercase tracking-widest text-stone-light">{format(currentDate, 'yyyy')}</p>
          </div>

          <button 
            onClick={nextMonth}
            className="p-3 hover:bg-stone-bg rounded-xl transition-all text-stone"
          >
            <ChevronRight size={20} />
          </button>
        </div>
      </header>

      <CalendarSyncModal 
        isOpen={isSyncModalOpen} 
        onClose={() => setIsSyncModalOpen(false)} 
      />

      {/* Desktop Grid View */}
      <div className="hidden md:block">
        <div className="grid grid-cols-7 mb-4">
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
            <div key={day} className="text-center">
              <span className="text-[10px] font-black uppercase tracking-[0.2em] text-stone-light/40">
                {day}
              </span>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-7 border-t border-l border-stone-border shadow-2xl shadow-stone/5 rounded-3xl overflow-hidden">
          {calendarDays.map((day, i) => {
            const dayEvents = getEventsForDay(day);
            const isCurrentMonth = isSameMonth(day, monthStart);
            const isTodayDay = isToday(day);

            return (
              <div 
                key={day.toString()}
                className={`min-h-[160px] p-4 border-r border-b border-stone-border transition-all group ${
                  !isCurrentMonth ? 'bg-stone-bg/30' : 'bg-white'
                } ${isTodayDay ? 'ring-2 ring-inset ring-stone' : ''}`}
              >
                <div className="flex justify-between items-start mb-3">
                  <span className={`text-sm font-bold ${
                    isTodayDay ? 'bg-stone text-white px-2 py-1 rounded-lg' : 
                    isCurrentMonth ? 'text-stone' : 'text-stone/20'
                  }`}>
                    {format(day, 'd')}
                  </span>
                </div>

                <div className="space-y-1.5">
                  {dayEvents.map((event, idx) => (
                    <button
                      key={idx}
                      onClick={() => navigate(`/family/${event.familyId}`)}
                      className={`w-full text-left p-2 rounded-lg text-[10px] font-bold leading-tight transition-all border flex items-center gap-2 group/event ${
                        event.type === 'birthday' 
                          ? 'bg-sage/5 border-sage/10 text-sage hover:bg-sage hover:text-white' 
                          : 'bg-terracotta/5 border-terracotta/10 text-terracotta hover:bg-terracotta hover:text-white'
                      }`}
                      title={event.label}
                    >
                      {event.type === 'birthday' ? <Cake size={12} className="shrink-0" /> : <Heart size={12} className="shrink-0" />}
                      <span className="truncate">{event.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Mobile / Shared List View */}
      <div className="md:hidden space-y-6">
        {monthEvents.length > 0 ? (
          Object.keys(groupedMonthEvents).map(dayKey => {
            const dayEvents = groupedMonthEvents[dayKey];
            const date = parseISO(dayKey);
            
            return (
              <motion.div 
                key={dayKey}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-white border border-stone-border rounded-3xl overflow-hidden shadow-sm"
              >
                <div className="bg-stone-bg/50 px-6 py-3 border-b border-stone-border flex justify-between items-center">
                  <span className="font-serif text-stone">{format(date, 'EEEE, MMM do')}</span>
                  {isToday(date) && <span className="bg-stone text-white text-[9px] font-black px-2 py-0.5 rounded-full uppercase tracking-widest">Today</span>}
                </div>
                <div className="divide-y divide-stone-border/50">
                  {dayEvents.map((event, idx) => (
                    <button
                      key={idx}
                      onClick={() => navigate(`/family/${event.familyId}`)}
                      className="w-full flex items-center justify-between p-6 hover:bg-stone-bg transition-colors text-left"
                    >
                      <div className="flex items-center gap-4">
                        <div className={`p-3 rounded-2xl ${
                          event.type === 'birthday' ? 'bg-sage/10 text-sage' : 'bg-terracotta/10 text-terracotta'
                        }`}>
                          {event.type === 'birthday' ? <Cake size={20} /> : <Heart size={20} />}
                        </div>
                        <div>
                          <p className="text-stone font-bold text-sm tracking-tight">{event.label}</p>
                          <div className="mt-2 flex items-center justify-between">
                            <p className="text-[10px] uppercase font-bold tracking-widest text-stone-light/60">
                              {event.type}
                            </p>
                            <CalendarActions 
                              name={event.entityName} 
                              date={event.originalDate} 
                              type={event.type === 'birthday' ? 'Birthday' : 'Anniversary'} 
                            />
                          </div>
                        </div>
                      </div>
                      <ArrowRight size={18} className="text-stone/20" />
                    </button>
                  ))}
                </div>
              </motion.div>
            );
          })
        ) : (
          <div className="py-20 text-center bg-white border border-dashed border-stone-border rounded-[40px]">
            <CalendarIcon size={48} className="mx-auto text-stone/10 mb-4" />
            <p className="font-serif text-xl text-stone-light">No celebrations this month</p>
            <p className="text-xs text-stone-light/60 mt-2">Check back soon!</p>
          </div>
        )}
      </div>
    </div>
  );
}
