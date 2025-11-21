import React from 'react';
import { ArrowUpRight, ArrowDownRight } from 'lucide-react';

interface MetricCardProps {
  title: string;
  value: string | number;
  change?: string;
  trend?: 'up' | 'down' | 'neutral';
  icon: React.ReactNode;
  color: string; // Expecting classes like 'bg-blue-500'
}

export const MetricCard: React.FC<MetricCardProps> = ({ title, value, change, trend, icon, color }) => {
  // Extract base color name to use for text (e.g., bg-blue-500 -> text-blue-600)
  const textColorClass = color.replace('bg-', 'text-').replace('500', '600');
  const bgOpacityClass = color.replace('500', '50');

  return (
    <div className="bg-white rounded-lg p-4 shadow-sm border border-slate-200 flex items-center justify-between">
      <div className="flex flex-col gap-1">
        <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">{title}</h3>
        <div className="flex items-baseline gap-2">
          <span className="text-2xl font-bold text-slate-900">{value}</span>
          {change && (
            <span className={`flex items-center text-xs font-medium ${
              trend === 'up' ? 'text-green-600' : trend === 'down' ? 'text-red-600' : 'text-slate-500'
            }`}>
              {trend === 'up' ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}
              {change}
            </span>
          )}
        </div>
      </div>
      
      <div className={`p-2.5 rounded-lg ${bgOpacityClass} ${textColorClass}`}>
        {React.isValidElement(icon) 
          ? React.cloneElement(icon as React.ReactElement<{ size?: number }>, { size: 20 }) 
          : icon}
      </div>
    </div>
  );
};