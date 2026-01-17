import React, { useState, useEffect } from 'react';
import { DayPicker, DateRange } from 'react-day-picker';
import { format, subDays, startOfDay, endOfDay } from 'date-fns';
import { uk, nb, enUS } from 'date-fns/locale';
import { X } from 'lucide-react';
import { useLanguage } from '../contexts/LanguageContext';
import 'react-day-picker/dist/style.css';

interface DateRangePickerProps {
  startDate: string;
  endDate: string;
  onRangeChange: (start: string, end: string) => void;
  onClose: () => void;
}

export const DateRangePicker: React.FC<DateRangePickerProps> = ({
  startDate,
  endDate,
  onRangeChange,
  onClose
}) => {
  const { t, language } = useLanguage();

  const getLocale = () => {
    switch (language) {
      case 'uk': return uk;
      case 'no': return nb;
      default: return enUS;
    }
  };

  const parseDate = (dateStr: string): Date | undefined => {
    if (!dateStr) return undefined;
    const parsed = new Date(dateStr);
    return isNaN(parsed.getTime()) ? undefined : parsed;
  };

  const [range, setRange] = useState<DateRange | undefined>(() => {
    const from = parseDate(startDate);
    const to = parseDate(endDate);
    if (from || to) {
      return { from, to };
    }
    return undefined;
  });

  const [month, setMonth] = useState<Date>(range?.from || new Date());

  useEffect(() => {
    if (range?.from) {
      const start = startOfDay(range.from).toISOString().split('T')[0];
      const end = range.to
        ? endOfDay(range.to).toISOString().split('T')[0]
        : start;
      onRangeChange(start, end);
    }
  }, [range]);

  const handleQuickSelect = (days: number) => {
    const today = new Date();
    if (days === 0) {
      const todayStr = startOfDay(today).toISOString().split('T')[0];
      setRange({ from: today, to: today });
      onRangeChange(todayStr, todayStr);
    } else {
      const start = subDays(today, days);
      setRange({ from: start, to: today });
      onRangeChange(
        startOfDay(start).toISOString().split('T')[0],
        endOfDay(today).toISOString().split('T')[0]
      );
    }
    setMonth(new Date());
  };

  const handleClear = () => {
    setRange(undefined);
    onRangeChange('', '');
  };

  const formatSelectedRange = () => {
    if (!range?.from) return '';
    const locale = getLocale();
    const fromStr = format(range.from, 'd MMM', { locale });
    if (!range.to || range.from.getTime() === range.to.getTime()) {
      return `${fromStr} ${format(range.from, 'yyyy')}`;
    }
    const toStr = format(range.to, 'd MMM yyyy', { locale });
    return `${fromStr} - ${toStr}`;
  };

  const quickOptions = [
    { label: t('dateRange.today'), days: 0 },
    { label: t('dateRange.days3'), days: 3 },
    { label: t('dateRange.week'), days: 7 },
  ];

  return (
    <div className="absolute top-full right-0 mt-1 bg-white rounded-lg shadow-xl border z-50 p-3 min-w-[300px]">
      {/* Quick Select Buttons */}
      <div className="flex gap-2 mb-3 pb-3 border-b">
        {quickOptions.map((opt) => (
          <button
            key={opt.days}
            onClick={() => handleQuickSelect(opt.days)}
            className="px-3 py-1.5 text-xs font-medium rounded-md bg-slate-100 hover:bg-blue-100 hover:text-blue-700 transition-colors"
          >
            {opt.label}
          </button>
        ))}
      </div>

      {/* Calendar */}
      <div className="flex justify-center">
        <DayPicker
          mode="range"
          selected={range}
          onSelect={setRange}
          month={month}
          onMonthChange={setMonth}
          locale={getLocale()}
          disabled={{ after: new Date() }}
          showOutsideDays
          classNames={{
            months: 'flex flex-col',
            month: 'space-y-2',
            caption: 'flex justify-center pt-1 relative items-center mb-2',
            caption_label: 'text-sm font-medium text-slate-700',
            nav: 'flex items-center gap-1',
            nav_button: 'h-7 w-7 bg-transparent p-0 hover:bg-slate-100 rounded-md flex items-center justify-center',
            nav_button_previous: 'absolute left-1',
            nav_button_next: 'absolute right-1',
            table: 'w-full border-collapse',
            head_row: 'flex',
            head_cell: 'text-slate-500 rounded-md w-9 font-normal text-[0.65rem] uppercase',
            row: 'flex w-full mt-1',
            cell: 'text-center text-sm p-0 relative [&:has([aria-selected])]:bg-blue-50 first:[&:has([aria-selected])]:rounded-l-md last:[&:has([aria-selected])]:rounded-r-md',
            day: 'h-9 w-9 p-0 font-normal rounded-md hover:bg-slate-100 transition-colors',
            day_selected: 'bg-blue-600 text-white hover:bg-blue-600 hover:text-white focus:bg-blue-600 focus:text-white',
            day_today: 'bg-amber-100 text-amber-900 font-semibold',
            day_outside: 'text-slate-300',
            day_disabled: 'text-slate-300 cursor-not-allowed hover:bg-transparent',
            day_range_middle: 'bg-blue-50 text-blue-900 rounded-none',
            day_range_end: 'bg-blue-600 text-white rounded-r-md',
            day_range_start: 'bg-blue-600 text-white rounded-l-md',
            day_hidden: 'invisible',
          }}
        />
      </div>

      {/* Footer: Selected Range & Clear Button */}
      <div className="flex items-center justify-between mt-3 pt-3 border-t">
        <span className="text-sm text-slate-600">
          {range?.from ? formatSelectedRange() : t('dateRange.noSelection')}
        </span>
        <button
          onClick={handleClear}
          className="text-xs text-red-500 hover:text-red-700 flex items-center gap-1"
        >
          <X size={12} /> {t('dateRange.clear')}
        </button>
      </div>
    </div>
  );
};
