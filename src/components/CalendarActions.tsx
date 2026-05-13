import { Download } from 'lucide-react';
import { motion } from 'motion/react';
import { toast } from 'sonner';

interface CalendarActionsProps {
  name: string;
  date: string; // YYYY-MM-DD
  type: 'Birthday' | 'Anniversary';
}

export default function CalendarActions({ name, date, type }: CalendarActionsProps) {
  if (!date) return null;

  const [year, month, day] = date.split('-').map(Number);
  const currentYear = new Date().getFullYear();
  
  // Format for Google Calendar (YYYYMMDD)
  const gDate = `${currentYear}${month.toString().padStart(2, '0')}${day.toString().padStart(2, '0')}`;
  const title = encodeURIComponent(`${name}'s ${type}`);
  const gLink = `https://www.google.com/calendar/render?action=TEMPLATE&text=${title}&dates=${gDate}/${gDate}&details=Church%20Family%20Directory&recur=RRULE:FREQ=YEARLY`;

  const downloadIcs = () => {
    const ical = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "BEGIN:VEVENT",
      `SUMMARY:${name}'s ${type}`,
      `DTSTART;VALUE=DATE:${currentYear}${month.toString().padStart(2, '0')}${day.toString().padStart(2, '0')}`,
      `DTEND;VALUE=DATE:${currentYear}${month.toString().padStart(2, '0')}${day.toString().padStart(2, '0')}`,
      "RRULE:FREQ=YEARLY",
      "DESCRIPTION:Church Family Directory",
      "END:VEVENT",
      "END:VCALENDAR"
    ].join("\r\n");

    const blob = new Blob([ical], { type: 'text/calendar;charset=utf-8' });
    const link = document.createElement('a');
    link.href = window.URL.createObjectURL(blob);
    link.setAttribute('download', `${name.replace(/\s+/g, '_')}_${type}.ics`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast.success("Calendar file downloaded");
  };

  return (
    <div className="flex items-center gap-2">
      <a 
        href={gLink} 
        target="_blank" 
        rel="noopener noreferrer"
        className="p-1 px-2 border border-stone-border rounded-lg hover:bg-stone-bg transition-all flex items-center gap-1.5 group"
        title="Add to Google Calendar"
      >
        <span className="text-[9px] uppercase font-bold text-stone-light group-hover:text-stone">Google</span>
        <ExternalLink size={10} className="text-sage" />
      </a>
      <button 
        onClick={downloadIcs}
        className="p-1 px-2 border border-stone-border rounded-lg hover:bg-stone-bg transition-all flex items-center gap-1.5 group"
        title="Download .ics"
      >
        <span className="text-[9px] uppercase font-bold text-stone-light group-hover:text-stone">.ics</span>
        <Download size={10} className="text-terracotta" />
      </button>
    </div>
  );
}

function ExternalLink({ size, className }: { size: number, className?: string }) {
  return (
    <svg 
      width={size} 
      height={size} 
      viewBox="0 0 24 24" 
      fill="none" 
      stroke="currentColor" 
      strokeWidth="2" 
      strokeLinecap="round" 
      strokeLinejoin="round" 
      className={className}
    >
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <polyline points="15 3 21 3 21 9" />
      <line x1="10" y1="14" x2="21" y2="3" />
    </svg>
  );
}
